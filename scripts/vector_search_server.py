#!/usr/bin/env python3
"""Local Qwen vector search server for MTG cards."""

from __future__ import annotations

import argparse
import json
import re
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoModelForCausalLM, AutoTokenizer


QUERY_PREFIX = (
    "Instruct: Given a natural language Magic: The Gathering card search query, "
    "retrieve cards with relevant names, colors, rules text, keywords, power, "
    "toughness, or loyalty.\nQuery: "
)
RERANKER_INSTRUCTION = (
    "Given a natural language Magic: The Gathering card search query, retrieve "
    "cards with relevant names, colors, rules text, keywords, power, toughness, "
    "or loyalty."
)
RERANKER_SYSTEM_PREFIX = (
    "<|im_start|>system\n"
    "Judge whether the Document meets the requirements based on the Query and "
    'the Instruct provided. Note that the answer can only be "yes" or "no".'
    "<|im_end|>\n<|im_start|>user\n"
)
RERANKER_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def resolve_device(device_arg: str) -> torch.device:
    if device_arg != "auto":
        return torch.device(device_arg)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def resolve_torch_dtype(dtype_arg: str, device: torch.device) -> torch.dtype:
    if dtype_arg == "float16":
        return torch.float16
    if dtype_arg == "bfloat16":
        return torch.bfloat16
    if dtype_arg == "float32":
        return torch.float32
    if device.type == "cuda":
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if device.type == "mps":
        return torch.float16
    return torch.float32


def last_token_pool(
    last_hidden_states: torch.Tensor,
    attention_mask: torch.Tensor,
) -> torch.Tensor:
    left_padding = attention_mask[:, -1].sum() == attention_mask.shape[0]
    if left_padding:
        return last_hidden_states[:, -1]

    sequence_lengths = attention_mask.sum(dim=1) - 1
    batch_size = last_hidden_states.shape[0]
    return last_hidden_states[
        torch.arange(batch_size, device=last_hidden_states.device),
        sequence_lengths,
    ]


def clean_filter_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip().upper() for item in value if isinstance(item, str) and item.strip()]


def contains_text(value: Any, needle: str) -> bool:
    if not isinstance(value, str):
        return False
    return needle.lower() in value.lower()


def comma_terms(value: str) -> list[str]:
    return [term.strip() for term in value.split(",") if term.strip()]


def full_oracle_text(card: dict[str, Any]) -> str:
    values: list[str] = []
    oracle_text = card.get("oracle_text")
    if isinstance(oracle_text, str):
        values.append(oracle_text)
    card_faces = card.get("card_faces")
    if isinstance(card_faces, list):
        for face in card_faces:
            if not isinstance(face, dict):
                continue
            face_text = face.get("oracle_text")
            if isinstance(face_text, str):
                values.append(face_text)
    return "\n".join(values)


def full_type_line(card: dict[str, Any]) -> str:
    values: list[str] = []
    type_line = card.get("type_line")
    if isinstance(type_line, str):
        values.append(type_line)
    card_faces = card.get("card_faces")
    if isinstance(card_faces, list):
        for face in card_faces:
            if not isinstance(face, dict):
                continue
            face_type = face.get("type_line")
            if isinstance(face_type, str):
                values.append(face_type)
    return " ".join(values)


def matches_colors(
    card: dict[str, Any],
    selected_colors: list[str],
    color_mode: Any,
) -> bool:
    selected = set(selected_colors)
    mode = color_mode if isinstance(color_mode, str) else "identity"
    card_colors = set(clean_string_list(card.get("colors")))
    identity = set(clean_string_list(card.get("color_identity")))
    values = identity if mode == "identity" else card_colors

    if mode == "exact":
        return values == selected
    if mode == "including":
        return values.issuperset(selected)
    return values.issubset(selected)


def matches_set(card: dict[str, Any], set_filter: str) -> bool:
    needle = set_filter.lower()
    card_set = card.get("set")
    if isinstance(card_set, str) and card_set.lower() == needle:
        return True
    printings = card.get("printings")
    return isinstance(printings, list) and any(
        isinstance(printing, str) and printing.lower() == needle
        for printing in printings
    )


def numeric_card_value(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def matches_numeric_expression(value: Any, expression: str) -> bool:
    number = numeric_card_value(value)
    if number is None:
        return False

    match = re.match(r"^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$", expression)
    if match is None:
        return False

    operator = match.group(1) or "="
    expected = float(match.group(2))
    if operator == "<":
        return number < expected
    if operator == "<=":
        return number <= expected
    if operator == ">":
        return number > expected
    if operator == ">=":
        return number >= expected
    return number == expected


def matches_format(card: dict[str, Any], format_filter: str) -> bool:
    legalities = card.get("legalities")
    if not isinstance(legalities, dict):
        return False
    status = legalities.get(format_filter.lower())
    return isinstance(status, str) and status.lower() == "legal"


class VectorSearchEngine:
    def __init__(self, args: argparse.Namespace) -> None:
        self.limit = args.default_limit
        self.max_limit = args.max_limit
        self.candidate_limit = args.candidate_limit
        self.max_length = args.max_length
        self.reranker_max_length = args.reranker_max_length
        self.reranker_batch_size = args.reranker_batch_size
        self.reranker_instruction = args.reranker_instruction
        self.default_rerank = args.default_rerank
        self.query_prefix = args.query_prefix
        self.device = resolve_device(args.device)
        self.torch_dtype = resolve_torch_dtype(args.torch_dtype, self.device)
        self.model_kwargs = {
            "torch_dtype": self.torch_dtype,
            "trust_remote_code": args.trust_remote_code,
        }

        with args.ids.open("r", encoding="utf-8") as ids_file:
            self.ids: list[str] = json.load(ids_file)
        with args.cards.open("r", encoding="utf-8") as cards_file:
            self.cards_by_id: dict[str, dict[str, Any]] = json.load(cards_file)
        with args.texts.open("r", encoding="utf-8") as texts_file:
            self.texts_by_id: dict[str, str] = json.load(texts_file)

        # Load into float32 once. The matrix is small enough locally and this
        # makes repeated cosine search much faster than re-casting a memmap.
        self.embeddings = np.load(args.embeddings).astype(np.float32, copy=False)
        if self.embeddings.shape[0] != len(self.ids):
            raise ValueError(
                f"embedding rows ({self.embeddings.shape[0]}) do not match "
                f"ids ({len(self.ids)})"
            )

        self.tokenizer = AutoTokenizer.from_pretrained(
            args.model,
            padding_side="left",
            trust_remote_code=args.trust_remote_code,
        )
        self.model = AutoModel.from_pretrained(args.model, **self.model_kwargs).to(
            self.device
        )
        self.model.eval()
        self.input_device = next(self.model.parameters()).device

        self.reranker_model_name = args.reranker_model
        self.trust_remote_code = args.trust_remote_code
        self.reranker_lock = threading.Lock()
        self.reranker_loaded = False
        self.reranker_tokenizer: AutoTokenizer | None = None
        self.reranker_model: AutoModelForCausalLM | None = None
        self.reranker_device: torch.device | None = None
        self.reranker_true_id: int | None = None
        self.reranker_false_id: int | None = None
        self.reranker_prefix_tokens: list[int] | None = None
        self.reranker_suffix_tokens: list[int] | None = None
        if args.preload_reranker:
            print("loading reranker model...")
            self.load_reranker()

    def embed_query(self, query: str) -> np.ndarray:
        text = f"{self.query_prefix}{query}" if self.query_prefix else query
        encoded = self.tokenizer(
            [text],
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        )
        encoded = {key: value.to(self.input_device) for key, value in encoded.items()}

        with torch.inference_mode():
            outputs = self.model(**encoded)
            pooled = last_token_pool(outputs.last_hidden_state, encoded["attention_mask"])
            pooled = F.normalize(pooled, p=2, dim=1)

        return pooled[0].float().cpu().numpy()

    def search(
        self,
        query: str,
        limit: int | None = None,
        rerank: bool | None = None,
        candidate_limit: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        query = query.strip()
        if not query:
            return {"query": query, "total": 0, "data": []}

        should_rerank = self.default_rerank if rerank is None else rerank
        result_limit = min(max(limit or self.limit, 1), self.max_limit)
        started_at = time.perf_counter()
        query_embedding = self.embed_query(query)
        embedded_at = time.perf_counter()
        scores = self.embeddings @ query_embedding
        eligible_indices = self.matching_indices(filters)
        if len(eligible_indices) == 0:
            ended_at = time.perf_counter()
            return {
                "query": query,
                "total": 0,
                "eligible_count": 0,
                "candidate_count": 0,
                "reranked": should_rerank,
                "timings_ms": {
                    "embed_query": round((embedded_at - started_at) * 1000),
                    "load_reranker": 0,
                    "rerank": 0,
                    "total": round((ended_at - started_at) * 1000),
                },
                "data": [],
            }

        candidate_count = min(
            max(candidate_limit or self.candidate_limit, result_limit),
            len(eligible_indices),
        )
        eligible_scores = scores[eligible_indices]
        top_local_indices = np.argpartition(eligible_scores, -candidate_count)[
            -candidate_count:
        ]
        top_local_indices = top_local_indices[
            np.argsort(eligible_scores[top_local_indices])[::-1]
        ]
        top_indices = eligible_indices[top_local_indices]
        if should_rerank:
            reranker_load_started_at = time.perf_counter()
            self.load_reranker()
            reranker_loaded_at = time.perf_counter()
            rerank_scores = self.rerank(query, top_indices)
            reranked_at = time.perf_counter()
            result_indices = top_indices[np.argsort(rerank_scores)[::-1]][:result_limit]
            rerank_score_by_row = {
                int(row_index): float(rerank_scores[index])
                for index, row_index in enumerate(top_indices)
            }
        else:
            reranker_load_started_at = embedded_at
            reranker_loaded_at = embedded_at
            reranked_at = embedded_at
            result_indices = top_indices[:result_limit]
            rerank_score_by_row = {}

        data: list[dict[str, Any]] = []
        for row_index in result_indices:
            oracle_id = self.ids[int(row_index)]
            card = self.cards_by_id.get(oracle_id)
            if card is None:
                continue
            item = dict(card)
            item["similarity"] = float(scores[int(row_index)])
            if should_rerank:
                item["rerank_score"] = rerank_score_by_row[int(row_index)]
            data.append(item)

        return {
            "query": query,
            "total": len(data),
            "eligible_count": len(eligible_indices),
            "candidate_count": candidate_count,
            "reranked": should_rerank,
            "timings_ms": {
                "embed_query": round((embedded_at - started_at) * 1000),
                "load_reranker": round(
                    (reranker_loaded_at - reranker_load_started_at) * 1000
                ),
                "rerank": round((reranked_at - reranker_loaded_at) * 1000),
                "total": round((reranked_at - started_at) * 1000),
            },
            "data": data,
        }

    def matching_indices(self, filters: dict[str, Any] | None) -> np.ndarray:
        if not filters:
            return np.arange(len(self.ids), dtype=np.int64)

        indices = [
            row_index
            for row_index, oracle_id in enumerate(self.ids)
            if self.card_matches_filters(self.cards_by_id.get(oracle_id) or {}, filters)
        ]
        return np.array(indices, dtype=np.int64)

    def card_matches_filters(
        self,
        card: dict[str, Any],
        filters: dict[str, Any],
    ) -> bool:
        name_filter = clean_filter_string(filters.get("name"))
        if name_filter and not contains_text(card.get("name"), name_filter):
            return False

        exclude_oracle = clean_filter_string(filters.get("excludeOracle"))
        if exclude_oracle:
            oracle_text = full_oracle_text(card)
            for term in comma_terms(exclude_oracle):
                if contains_text(oracle_text, term):
                    return False

        type_filter = clean_filter_string(filters.get("type"))
        if type_filter and not contains_text(full_type_line(card), type_filter):
            return False

        colors = clean_string_list(filters.get("colors"))
        if colors and not matches_colors(card, colors, filters.get("colorMode")):
            return False

        set_filter = clean_filter_string(filters.get("set"))
        if set_filter and not matches_set(card, set_filter):
            return False

        cmc = numeric_card_value(card.get("cmc"))
        cmc_min = numeric_card_value(filters.get("cmcMin"))
        if cmc_min is not None and (cmc is None or cmc < cmc_min):
            return False
        cmc_max = numeric_card_value(filters.get("cmcMax"))
        if cmc_max is not None and (cmc is None or cmc > cmc_max):
            return False

        power_filter = clean_filter_string(filters.get("power"))
        if power_filter and not matches_numeric_expression(
            card.get("power"),
            power_filter,
        ):
            return False

        toughness_filter = clean_filter_string(filters.get("toughness"))
        if toughness_filter and not matches_numeric_expression(
            card.get("toughness"),
            toughness_filter,
        ):
            return False

        format_filter = clean_filter_string(filters.get("format"))
        if format_filter and not matches_format(card, format_filter):
            return False

        return True

    def load_reranker(self) -> None:
        if self.reranker_loaded:
            return
        with self.reranker_lock:
            if self.reranker_loaded:
                return
            self.reranker_tokenizer = AutoTokenizer.from_pretrained(
                self.reranker_model_name,
                padding_side="left",
                trust_remote_code=self.trust_remote_code,
            )
            self.reranker_model = AutoModelForCausalLM.from_pretrained(
                self.reranker_model_name,
                **self.model_kwargs,
            ).to(self.device)
            self.reranker_model.eval()
            self.reranker_device = next(self.reranker_model.parameters()).device
            self.reranker_true_id = self.reranker_tokenizer.convert_tokens_to_ids("yes")
            self.reranker_false_id = self.reranker_tokenizer.convert_tokens_to_ids("no")
            self.reranker_prefix_tokens = self.reranker_tokenizer.encode(
                RERANKER_SYSTEM_PREFIX,
                add_special_tokens=False,
            )
            self.reranker_suffix_tokens = self.reranker_tokenizer.encode(
                RERANKER_SUFFIX,
                add_special_tokens=False,
            )
            self.reranker_loaded = True

    def rerank(self, query: str, row_indices: np.ndarray) -> np.ndarray:
        if (
            self.reranker_model is None
            or self.reranker_tokenizer is None
            or self.reranker_device is None
            or self.reranker_true_id is None
            or self.reranker_false_id is None
        ):
            raise RuntimeError("reranker is not loaded")

        pairs = [
            (
                index,
                self.format_reranker_pair(
                    query,
                    self.texts_by_id.get(self.ids[int(row_index)], ""),
                ),
            )
            for index, row_index in enumerate(row_indices)
        ]
        # Length-bucket batches to reduce padding. Scores are written back to
        # original candidate positions so reranking semantics stay unchanged.
        pairs.sort(key=lambda item: len(item[1]))
        scores = np.zeros(len(row_indices), dtype=np.float32)
        for start in range(0, len(pairs), self.reranker_batch_size):
            batch = pairs[start : start + self.reranker_batch_size]
            batch_positions = [position for position, _pair in batch]
            batch_pairs = [_pair for _position, _pair in batch]
            inputs = self.process_reranker_inputs(batch_pairs)
            with torch.inference_mode():
                logits = self.reranker_model(**inputs).logits[:, -1, :]
                yes_logits = logits[:, self.reranker_true_id]
                no_logits = logits[:, self.reranker_false_id]
                yes_no_logits = torch.stack([no_logits, yes_logits], dim=1)
                batch_scores = F.log_softmax(yes_no_logits, dim=1)[:, 1].exp()
            for position, score in zip(batch_positions, batch_scores.float().cpu()):
                scores[position] = float(score)
        return scores

    def format_reranker_pair(self, query: str, document: str) -> str:
        return (
            f"<Instruct>: {self.reranker_instruction}\n"
            f"<Query>: {query}\n"
            f"<Document>: {document}"
        )

    def process_reranker_inputs(self, pairs: list[str]) -> dict[str, torch.Tensor]:
        max_pair_length = max(
            1,
            self.reranker_max_length
            - len(self.reranker_prefix_tokens or [])
            - len(self.reranker_suffix_tokens or []),
        )
        if (
            self.reranker_tokenizer is None
            or self.reranker_prefix_tokens is None
            or self.reranker_suffix_tokens is None
            or self.reranker_device is None
        ):
            raise RuntimeError("reranker is not loaded")

        inputs = self.reranker_tokenizer(
            pairs,
            padding=False,
            truncation="longest_first",
            return_attention_mask=False,
            max_length=max_pair_length,
        )
        for index, input_ids in enumerate(inputs["input_ids"]):
            inputs["input_ids"][index] = (
                self.reranker_prefix_tokens
                + input_ids
                + self.reranker_suffix_tokens
            )
        padded = self.reranker_tokenizer.pad(
            inputs,
            padding=True,
            return_tensors="pt",
        )
        return {key: value.to(self.reranker_device) for key, value in padded.items()}

    def get_card(self, card_id: str) -> dict[str, Any] | None:
        oracle_id = card_id.removeprefix("oracle:")
        return self.cards_by_id.get(oracle_id)


class Handler(BaseHTTPRequestHandler):
    engine: VectorSearchEngine

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.write_json({"ok": True, "cards": len(self.engine.ids)})
            return
        if parsed.path == "/card":
            query = parse_qs(parsed.query)
            card_id = query.get("id", [""])[0]
            card = self.engine.get_card(card_id)
            if card is None:
                self.write_json({"error": "card not found"}, HTTPStatus.NOT_FOUND)
                return
            self.write_json(card)
            return

        self.write_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/search":
            self.write_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            query = payload.get("query")
            limit = payload.get("limit")
            if not isinstance(query, str):
                self.write_json(
                    {"error": "query must be a string"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            if limit is not None and not isinstance(limit, int):
                self.write_json(
                    {"error": "limit must be an integer"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            rerank = payload.get("rerank")
            if rerank is not None and not isinstance(rerank, bool):
                self.write_json(
                    {"error": "rerank must be a boolean"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            candidate_limit = payload.get("candidate_limit", payload.get("candidateLimit"))
            if candidate_limit is not None and not isinstance(candidate_limit, int):
                self.write_json(
                    {"error": "candidate_limit must be an integer"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            filters = payload.get("filters")
            if filters is not None and not isinstance(filters, dict):
                self.write_json(
                    {"error": "filters must be an object"},
                    HTTPStatus.BAD_REQUEST,
                )
                return

            self.write_json(
                self.engine.search(
                    query,
                    limit,
                    rerank=rerank,
                    candidate_limit=candidate_limit,
                    filters=filters,
                )
            )
        except Exception as exc:  # noqa: BLE001 - return clean local API errors.
            self.write_json(
                {"error": str(exc)},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def write_json(
        self,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve local MTG vector search.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="Qwen/Qwen3-Embedding-8B")
    parser.add_argument("--reranker-model", default="Qwen/Qwen3-Reranker-0.6B")
    parser.add_argument("--device", default="mps")
    parser.add_argument(
        "--torch-dtype",
        choices=("auto", "float16", "bfloat16", "float32"),
        default="auto",
    )
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--reranker-max-length", type=int, default=512)
    parser.add_argument("--reranker-batch-size", type=int, default=64)
    parser.add_argument("--default-limit", type=int, default=32)
    parser.add_argument("--max-limit", type=int, default=128)
    parser.add_argument("--candidate-limit", type=int, default=128)
    parser.add_argument(
        "--preload-reranker",
        action="store_true",
        dest="preload_reranker",
        help="Load the reranker during startup.",
    )
    parser.add_argument(
        "--no-preload-reranker",
        action="store_false",
        dest="preload_reranker",
        help="Load the reranker lazily on the first reranked query.",
    )
    parser.add_argument(
        "--no-default-rerank",
        action="store_false",
        dest="default_rerank",
        help="Return pure embedding results by default unless a request passes rerank=true.",
    )
    parser.set_defaults(default_rerank=True, preload_reranker=True)
    parser.add_argument("--trust-remote-code", action="store_true")
    parser.add_argument("--query-prefix", default=QUERY_PREFIX)
    parser.add_argument("--reranker-instruction", default=RERANKER_INSTRUCTION)
    parser.add_argument(
        "--embeddings",
        type=Path,
        default=Path("data/qwen3_card_embeddings.float16.npy"),
    )
    parser.add_argument(
        "--ids",
        type=Path,
        default=Path("data/qwen3_card_embedding_ids.json"),
    )
    parser.add_argument(
        "--cards",
        type=Path,
        default=Path("data/local_card_index.json"),
    )
    parser.add_argument(
        "--texts",
        type=Path,
        default=Path("data/scryfall_card_texts.json"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print("loading local vector search engine...")
    Handler.engine = VectorSearchEngine(args)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"serving vector search on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
