#!/usr/bin/env python3
"""Embed Scryfall card text with Qwen/Qwen3-Embedding-8B."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable, NamedTuple

import numpy as np
import torch
import torch.nn.functional as F
from tqdm.auto import tqdm
from transformers import AutoModel, AutoTokenizer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Construct one embedding per Scryfall Oracle ID."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/scryfall_card_texts.json"),
        help="JSON object mapping Scryfall Oracle IDs to text.",
    )
    parser.add_argument(
        "--embeddings-output",
        type=Path,
        default=Path("data/qwen3_card_embeddings.float16.npy"),
        help="Output .npy matrix with rows aligned to --ids-output.",
    )
    parser.add_argument(
        "--ids-output",
        type=Path,
        default=Path("data/qwen3_card_embedding_ids.json"),
        help="Output JSON array of Scryfall Oracle IDs in embedding row order.",
    )
    parser.add_argument(
        "--metadata-output",
        type=Path,
        default=Path("data/qwen3_card_embeddings.metadata.json"),
        help="Output JSON metadata for the embedding run.",
    )
    parser.add_argument(
        "--model",
        default="Qwen/Qwen3-Embedding-8B",
        help="Hugging Face model name or local path.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Embedding batch size. Lower this if you run out of memory.",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=512,
        help="Tokenizer max sequence length.",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="Device to use: auto, cuda, mps, cpu, or a specific torch device.",
    )
    parser.add_argument(
        "--device-map",
        default=None,
        help="Optional transformers device_map, e.g. auto for multi-GPU loading.",
    )
    parser.add_argument(
        "--torch-dtype",
        choices=("auto", "float16", "bfloat16", "float32"),
        default="auto",
        help="Model dtype.",
    )
    parser.add_argument(
        "--output-dtype",
        choices=("float16", "float32"),
        default="float16",
        help="Saved embedding dtype.",
    )
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Pass trust_remote_code=True to transformers.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Embed only the first N IDs; useful for a smoke test.",
    )
    parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="Disable L2 normalization of embeddings.",
    )
    parser.add_argument(
        "--no-length-bucketing",
        action="store_true",
        help="Disable length-bucketed batching. By default, similarly sized texts are batched together to reduce padding.",
    )
    return parser.parse_args()


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


class TextJob(NamedTuple):
    row_index: int
    text: str


def batches(items: list[TextJob], batch_size: int) -> Iterable[list[TextJob]]:
    for start in range(0, len(items), batch_size):
        yield items[start : start + batch_size]


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


def load_texts(input_path: Path, limit: int | None) -> tuple[list[str], list[str]]:
    with input_path.open("r", encoding="utf-8") as input_file:
        text_by_id = json.load(input_file)

    if not isinstance(text_by_id, dict):
        raise ValueError(f"{input_path} must contain a JSON object")

    ids = sorted(text_by_id)
    if limit is not None:
        ids = ids[:limit]

    texts = [str(text_by_id[oracle_id]) for oracle_id in ids]
    return ids, texts


def main() -> None:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("--batch-size must be at least 1")

    ids, texts = load_texts(args.input, args.limit)
    if not ids:
        raise ValueError(f"no texts found in {args.input}")

    jobs = [TextJob(row_index=index, text=text) for index, text in enumerate(texts)]
    if not args.no_length_bucketing:
        jobs.sort(key=lambda job: len(job.text))

    device = resolve_device(args.device)
    torch_dtype = resolve_torch_dtype(args.torch_dtype, device)

    tokenizer = AutoTokenizer.from_pretrained(
        args.model,
        padding_side="left",
        trust_remote_code=args.trust_remote_code,
    )
    model_kwargs = {
        "torch_dtype": torch_dtype,
        "trust_remote_code": args.trust_remote_code,
    }
    if args.device_map:
        model_kwargs["device_map"] = args.device_map

    model = AutoModel.from_pretrained(args.model, **model_kwargs)
    if not args.device_map:
        model = model.to(device)
    model.eval()

    input_device = next(model.parameters()).device
    output_dtype = np.float16 if args.output_dtype == "float16" else np.float32

    args.embeddings_output.parent.mkdir(parents=True, exist_ok=True)
    args.ids_output.parent.mkdir(parents=True, exist_ok=True)
    args.metadata_output.parent.mkdir(parents=True, exist_ok=True)

    embeddings = None
    embedding_dim = None

    with torch.inference_mode():
        progress = tqdm(
            batches(jobs, args.batch_size),
            total=(len(jobs) + args.batch_size - 1) // args.batch_size,
            desc="Embedding cards",
            unit="batch",
        )
        completed = 0
        for batch_jobs in progress:
            batch_texts = [job.text for job in batch_jobs]
            encoded = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=args.max_length,
                return_tensors="pt",
            )
            encoded = {key: value.to(input_device) for key, value in encoded.items()}

            outputs = model(**encoded)
            pooled = last_token_pool(outputs.last_hidden_state, encoded["attention_mask"])
            if not args.no_normalize:
                pooled = F.normalize(pooled, p=2, dim=1)

            batch_embeddings = pooled.float().cpu().numpy()

            if embeddings is None:
                embedding_dim = batch_embeddings.shape[1]
                embeddings = np.lib.format.open_memmap(
                    args.embeddings_output,
                    mode="w+",
                    dtype=output_dtype,
                    shape=(len(ids), embedding_dim),
                )

            row_indices = [job.row_index for job in batch_jobs]
            embeddings[row_indices] = batch_embeddings.astype(output_dtype, copy=False)
            embeddings.flush()
            completed += len(batch_texts)
            progress.set_postfix(rows=completed)

    if embeddings is None or embedding_dim is None:
        raise RuntimeError("embedding loop did not produce any rows")

    args.ids_output.write_text(json.dumps(ids, indent=2) + "\n", encoding="utf-8")
    metadata = {
        "model": args.model,
        "input": str(args.input),
        "embeddings_output": str(args.embeddings_output),
        "ids_output": str(args.ids_output),
        "count": len(ids),
        "dimension": embedding_dim,
        "max_length": args.max_length,
        "normalized": not args.no_normalize,
        "length_bucketing": not args.no_length_bucketing,
        "torch_dtype": str(torch_dtype).replace("torch.", ""),
        "output_dtype": args.output_dtype,
    }
    args.metadata_output.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"wrote {len(ids)} embeddings to {args.embeddings_output}")
    print(f"wrote row IDs to {args.ids_output}")
    print(f"wrote metadata to {args.metadata_output}")


if __name__ == "__main__":
    main()
