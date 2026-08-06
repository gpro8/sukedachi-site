#!/usr/bin/env python3
"""Parse Sukedachi AL Discord export → unique wallets + ALLOWLIST string.

Usage:
  # A) Paste webhook-style messages into a text file, then:
  python3 scripts/parse_al_discord.py channel_export.txt

  # B) JSON from DiscordChatExporter:
  python3 scripts/parse_al_discord.py export.json

Writes:
  allowlist_wallets.csv
  ALLOWLIST.txt   (comma-separated for forge ALLOWLIST=)
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ADDR = re.compile(r"0x[a-fA-F0-9]{40}")
# webhook format we post
LINE_X = re.compile(r"X:\s*`([^`]+)`")
LINE_D = re.compile(r"Discord:\s*`([^`]+)`")
LINE_W = re.compile(r"Wallet:\s*`(0x[a-fA-F0-9]{40})`", re.I)


def from_text(text: str) -> list[dict]:
    rows: list[dict] = []
    # split on our header or blank blocks
    blocks = re.split(r"\*\*助太刀 AL 提出\*\*", text)
    if len(blocks) <= 1:
        # fallback: any 0x address
        seen = set()
        for m in ADDR.finditer(text):
            w = m.group(0)
            k = w.lower()
            if k not in seen:
                seen.add(k)
                rows.append({"wallet": w, "x": "", "discord": ""})
        return rows

    for b in blocks[1:]:
        wx = LINE_X.search(b)
        wd = LINE_D.search(b)
        ww = LINE_W.search(b) or ADDR.search(b)
        if not ww:
            continue
        rows.append(
            {
                "wallet": ww.group(1) if ww.lastindex else ww.group(0),
                "x": (wx.group(1) if wx else "").lstrip("@"),
                "discord": wd.group(1) if wd else "",
            }
        )
    return dedupe(rows)


def from_json(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    messages = data if isinstance(data, list) else data.get("messages") or data.get("Messages") or []
    chunks = []
    for m in messages:
        c = m.get("content") or m.get("Content") or ""
        chunks.append(c)
    return from_text("\n\n".join(chunks))


def dedupe(rows: list[dict]) -> list[dict]:
    out, seen = [], set()
    for r in rows:
        w = r["wallet"]
        k = w.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    if not src.exists():
        print("not found:", src)
        return 1
    raw = src.read_text(encoding="utf-8", errors="replace")
    if src.suffix.lower() == ".json":
        rows = from_json(src)
    else:
        rows = from_text(raw)

    out_dir = src.parent
    csv_path = out_dir / "allowlist_wallets.csv"
    al_path = out_dir / "ALLOWLIST.txt"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["wallet", "x", "discord"])
        w.writeheader()
        w.writerows(rows)
    al_path.write_text(",".join(r["wallet"] for r in rows), encoding="utf-8")
    print(f"{len(rows)} unique wallets")
    print("csv:", csv_path)
    print("ALLOWLIST:", al_path)
    print(al_path.read_text()[:200], ("…" if len(rows) > 3 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
