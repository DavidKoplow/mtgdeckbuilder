#!/usr/bin/env python3
"""Build local ScryfallCard-shaped display data from AtomicCards.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from tqdm.auto import tqdm


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value or None


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = "\n".join(line.strip() for line in value.splitlines())
    return value.strip() or None


def clean_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str) or item in seen:
            continue
        out.append(item)
        seen.add(item)
    return out


def first_present(cards: list[dict[str, Any]], *keys: str) -> Any:
    for card in cards:
        for key in keys:
            value = card.get(key)
            if value not in (None, "", []):
                return value
    return None


def union_string_list(cards: list[dict[str, Any]], key: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for card in cards:
        for item in clean_list(card.get(key)):
            if item in seen:
                continue
            values.append(item)
            seen.add(item)
    return values


def union_legalities(cards: list[dict[str, Any]]) -> dict[str, str]:
    legalities: dict[str, str] = {}
    for card in cards:
        card_legalities = card.get("legalities")
        if not isinstance(card_legalities, dict):
            continue
        for format_name, status in card_legalities.items():
            if not isinstance(format_name, str) or not isinstance(status, str):
                continue
            normalized = format_name.lower()
            existing = legalities.get(normalized)
            if existing is None or status == "Legal":
                legalities[normalized] = status
    return legalities


def unique_texts(cards: list[dict[str, Any]], key: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for card in cards:
        value = clean_text(card.get(key))
        if value is None or value in seen:
            continue
        values.append(value)
        seen.add(value)
    return values


def build_card(
    oracle_id: str,
    display_name: str,
    cards: list[dict[str, Any]],
) -> dict[str, Any]:
    colors = union_string_list(cards, "colors")
    color_identity = union_string_list(cards, "colorIdentity")
    printings = union_string_list(cards, "printings")
    legalities = union_legalities(cards)
    type_lines = unique_texts(cards, "type")
    oracle_texts = unique_texts(cards, "text")
    mana_cost = clean_string(first_present(cards, "manaCost"))
    cmc = clean_number(first_present(cards, "manaValue", "convertedManaCost"))

    local_id = f"oracle:{oracle_id}"
    card: dict[str, Any] = {
        "id": local_id,
        "oracle_id": oracle_id,
        "name": display_name,
        "scryfall_uri": (
            "https://scryfall.com/search?q="
            f"oracleid%3A{oracle_id}&unique=cards"
        ),
    }

    if mana_cost:
        card["mana_cost"] = mana_cost
    if cmc is not None:
        card["cmc"] = cmc
    if type_lines:
        card["type_line"] = " // ".join(type_lines)
    if oracle_texts:
        card["oracle_text"] = "\n//\n".join(oracle_texts)
    if colors:
        card["colors"] = colors
    if color_identity:
        card["color_identity"] = color_identity
    if printings:
        card["printings"] = [printing.lower() for printing in printings]
        card["set"] = printings[-1].lower()
        card["set_name"] = ", ".join(printings[-3:])
    if legalities:
        card["legalities"] = legalities

    for atomic_key, scryfall_key in (
        ("power", "power"),
        ("toughness", "toughness"),
        ("loyalty", "loyalty"),
        ("layout", "layout"),
    ):
        value = clean_string(first_present(cards, atomic_key))
        if value:
            card[scryfall_key] = value

    if len(cards) > 1:
        faces: list[dict[str, Any]] = []
        for atomic in cards:
            face: dict[str, Any] = {"name": clean_string(atomic.get("name")) or display_name}
            face_mana = clean_string(atomic.get("manaCost"))
            face_type = clean_string(atomic.get("type"))
            face_text = clean_text(atomic.get("text"))
            face_power = clean_string(atomic.get("power"))
            face_toughness = clean_string(atomic.get("toughness"))
            if face_mana:
                face["mana_cost"] = face_mana
            if face_type:
                face["type_line"] = face_type
            if face_text:
                face["oracle_text"] = face_text
            if face_power:
                face["power"] = face_power
            if face_toughness:
                face["toughness"] = face_toughness
            faces.append(face)
        card["card_faces"] = faces

    return card


def build_index(source: Path, ids_path: Path) -> dict[str, dict[str, Any]]:
    with source.open("r", encoding="utf-8") as source_file:
        payload = json.load(source_file)
    with ids_path.open("r", encoding="utf-8") as ids_file:
        embedding_ids = json.load(ids_file)

    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"{source} does not look like AtomicCards.json")
    if not isinstance(embedding_ids, list):
        raise ValueError(f"{ids_path} must contain a JSON array")

    grouped: dict[str, tuple[str, list[dict[str, Any]]]] = {}
    for display_name, atomic_cards in tqdm(
        data.items(),
        total=len(data),
        desc="Reading AtomicCards",
        unit="card",
    ):
        if not isinstance(atomic_cards, list):
            continue
        for atomic_card in atomic_cards:
            if not isinstance(atomic_card, dict):
                continue
            identifiers = atomic_card.get("identifiers")
            oracle_id = (
                identifiers.get("scryfallOracleId")
                if isinstance(identifiers, dict)
                else None
            )
            if not isinstance(oracle_id, str) or not oracle_id:
                continue

            existing = grouped.setdefault(oracle_id, (display_name, []))
            existing[1].append(atomic_card)

    index: dict[str, dict[str, Any]] = {}
    for oracle_id in tqdm(
        embedding_ids,
        total=len(embedding_ids),
        desc="Writing local card index",
        unit="card",
    ):
        if not isinstance(oracle_id, str):
            continue
        grouped_card = grouped.get(oracle_id)
        if grouped_card is None:
            continue
        display_name, atomic_cards = grouped_card
        index[oracle_id] = build_card(oracle_id, display_name, atomic_cards)

    return index


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build local display metadata aligned to card embedding IDs."
    )
    parser.add_argument("--source", type=Path, default=Path("AtomicCards.json"))
    parser.add_argument(
        "--ids",
        type=Path,
        default=Path("data/qwen3_card_embedding_ids.json"),
        help="Embedding row ID JSON generated by embed_card_texts_qwen3.py.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/local_card_index.json"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    index = build_index(args.source, args.ids)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(index, ensure_ascii=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(index)} cards to {args.output}")


if __name__ == "__main__":
    main()
