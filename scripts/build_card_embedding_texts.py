#!/usr/bin/env python3
"""Build compact embedding text for each Scryfall Oracle ID in AtomicCards.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from tqdm.auto import tqdm


TEXT_FIELDS = (
    "name",
    "text",
    "keywords",
    "type",
    "colors",
    "colorIdentity",
    "manaCost",
    "manaValue",
    "power",
    "toughness",
    "loyalty",
)


def flatten_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def flatten_list(value: Any) -> str:
    if not isinstance(value, list):
        return flatten_scalar(value)
    parts = [flatten_scalar(item) for item in value]
    return ", ".join(part for part in parts if part)


def card_fragment(card: dict[str, Any], fallback_name: str) -> str:
    parts: list[str] = []
    name = flatten_scalar(card.get("name")) or fallback_name
    text = flatten_scalar(card.get("text"))

    if name:
        parts.append(f"name: {name}")

    if text:
        parts.append(f"text: {text}")

    card_type = flatten_scalar(card.get("type"))
    if card_type:
        parts.append(f"type: {card_type}")

    if "colors" in card:
        colors = flatten_list(card.get("colors")) or "colorless"
        parts.append(f"colors: {colors}")

    color_identity = flatten_list(card.get("colorIdentity"))
    if color_identity:
        parts.append(f"color identity: {color_identity}")

    mana_cost = flatten_scalar(card.get("manaCost"))
    if mana_cost:
        parts.append(f"mana cost: {mana_cost}")

    mana_value = flatten_scalar(card.get("manaValue"))
    if mana_value:
        parts.append(f"mana value: {mana_value}")

    keywords = flatten_list(card.get("keywords"))
    if keywords:
        parts.append(f"keywords: {keywords}")

    for field in ("power", "toughness", "loyalty"):
        value = flatten_scalar(card.get(field))
        if value:
            parts.append(f"{field}: {value}")

    return "; ".join(parts)


def build_text_map(source: Path) -> dict[str, str]:
    with source.open("r", encoding="utf-8") as input_file:
        payload = json.load(input_file)

    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"{source} does not look like an AtomicCards.json file")

    fragments_by_id: dict[str, list[str]] = {}
    seen_fragments_by_id: dict[str, set[str]] = {}
    missing_oracle_id = 0
    total_card_objects = 0

    for card_name, card_objects in tqdm(
        data.items(),
        total=len(data),
        desc="Building Scryfall text map",
        unit="card",
    ):
        if not isinstance(card_objects, list):
            continue

        for card in card_objects:
            total_card_objects += 1
            if not isinstance(card, dict):
                continue

            identifiers = card.get("identifiers")
            oracle_id = (
                identifiers.get("scryfallOracleId")
                if isinstance(identifiers, dict)
                else None
            )
            if not isinstance(oracle_id, str) or not oracle_id:
                missing_oracle_id += 1
                continue

            fragment = card_fragment(card, card_name)
            if not fragment:
                continue

            seen = seen_fragments_by_id.setdefault(oracle_id, set())
            if fragment in seen:
                continue

            seen.add(fragment)
            fragments_by_id.setdefault(oracle_id, []).append(fragment)

    text_by_id = {
        oracle_id: "\n".join(fragments)
        for oracle_id, fragments in sorted(fragments_by_id.items())
    }

    tqdm.write(f"card objects read: {total_card_objects}")
    tqdm.write(f"unique oracle IDs: {len(text_by_id)}")
    tqdm.write(f"objects without oracle ID: {missing_oracle_id}")
    return text_by_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create a JSON object mapping Scryfall Oracle IDs to embedding text "
            "built from name, rules text, type, colors, mana cost, keywords, "
            "power, toughness, and loyalty."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("AtomicCards.json"),
        help="Path to AtomicCards.json.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/scryfall_card_texts.json"),
        help="Output JSON path.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the JSON output instead of writing compact JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    text_by_id = build_text_map(args.source)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output_file:
        if args.pretty:
            json.dump(text_by_id, output_file, ensure_ascii=True, indent=2)
        else:
            json.dump(text_by_id, output_file, ensure_ascii=True, separators=(",", ":"))
        output_file.write("\n")

    print(f"wrote {len(text_by_id)} records to {args.output}")


if __name__ == "__main__":
    main()
