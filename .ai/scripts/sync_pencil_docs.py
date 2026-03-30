#!/usr/bin/env python3
"""Sync a local snapshot of Pencil docs for durable repo reference."""

from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup, NavigableString, Tag

DOCS_ROOT = "https://docs.pencil.dev"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "reference" / "pencil"
PAGES_ROOT = OUTPUT_ROOT / "pages"
USER_AGENT = "chatbox-harness-pencil-doc-sync/1.0"


def fetch_html(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request) as response:
        return response.read().decode("utf-8")


def discover_routes(index_html: str) -> list[str]:
    soup = BeautifulSoup(index_html, "html.parser")
    routes: list[str] = ["/"]
    for anchor in soup.select("aside a[href]"):
        href = (anchor.get("href") or "").strip()
        if not href or href.startswith("#") or href.startswith("http"):
            continue
        if href == "/":
            continue
        if re.match(r"^/(getting-started|core-concepts|design-and-code|for-developers)(/|$)", href):
            routes.append(href)
        elif href == "/troubleshooting":
            routes.append(href)
    deduped: list[str] = []
    seen: set[str] = set()
    for route in routes:
        if route not in seen:
            seen.add(route)
            deduped.append(route)
    return deduped


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def tag_text(tag: Tag) -> str:
    return normalize_space(tag.get_text(" ", strip=True))


def render_table(tag: Tag) -> str:
    rows: list[list[str]] = []
    for row in tag.select("tr"):
        cells = [tag_text(cell) for cell in row.find_all(["th", "td"], recursive=False)]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    widths = [max(len(row[i]) for row in rows if i < len(row)) for i in range(max(len(r) for r in rows))]
    rendered_rows: list[str] = []
    for index, row in enumerate(rows):
        padded = [(row[i] if i < len(row) else "").ljust(widths[i]) for i in range(len(widths))]
        rendered_rows.append("| " + " | ".join(padded) + " |")
        if index == 0:
            rendered_rows.append("| " + " | ".join("-" * width for width in widths) + " |")
    return "\n".join(rendered_rows) + "\n\n"


def render_list(tag: Tag, depth: int = 0) -> str:
    ordered = tag.name == "ol"
    lines: list[str] = []
    for index, item in enumerate(tag.find_all("li", recursive=False), start=1):
        inline_parts: list[str] = []
        nested_parts: list[str] = []
        for child in item.children:
            if isinstance(child, NavigableString):
                text = normalize_space(str(child))
                if text:
                    inline_parts.append(text)
                continue
            if not isinstance(child, Tag):
                continue
            if child.name in {"ul", "ol"}:
                nested_parts.append(render_list(child, depth + 1).rstrip())
            elif child.name == "pre":
                code = child.get_text("\n", strip=False).strip("\n")
                if code:
                    nested_parts.append(f"```text\n{code}\n```")
            else:
                text = tag_text(child)
                if text:
                    inline_parts.append(text)
        prefix = f"{index}. " if ordered else "- "
        line = "  " * depth + prefix + normalize_space(" ".join(inline_parts))
        lines.append(line.rstrip())
        lines.extend(part for part in nested_parts if part)
    return "\n".join(lines) + "\n\n"


def render_block(tag: Tag) -> str:
    if tag.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(tag.name[1])
        return f"{'#' * level} {tag_text(tag)}\n\n"
    if tag.name == "p":
        text = tag_text(tag)
        return f"{text}\n\n" if text else ""
    if tag.name in {"ul", "ol"}:
        return render_list(tag)
    if tag.name == "pre":
        code = tag.get_text("\n", strip=False).strip("\n")
        return f"```text\n{code}\n```\n\n" if code else ""
    if tag.name == "blockquote":
        text = "\n".join(f"> {line}" for line in tag.get_text("\n", strip=True).splitlines() if line.strip())
        return f"{text}\n\n" if text else ""
    if tag.name == "table":
        return render_table(tag)
    if tag.name in {"div", "section"}:
        return "".join(render_block(child) for child in tag.children if isinstance(child, Tag))
    return ""


def extract_page_snapshot(route: str, html: str, fetched_at: str) -> tuple[str, dict]:
    soup = BeautifulSoup(html, "html.parser")
    title = tag_text(soup.select_one("article h1") or soup.select_one("title") or soup.new_tag("span"))
    last_updated = tag_text(soup.select_one("article time") or soup.new_tag("span")) or "Unknown"
    main = soup.select_one("article main")
    if main is None:
        raise RuntimeError(f"Could not find article main for {route}")

    body_parts: list[str] = []
    for child in main.children:
        if isinstance(child, Tag):
            body_parts.append(render_block(child))
    body = "".join(body_parts).strip() + "\n"
    source_url = f"{DOCS_ROOT}{route}"
    page_text = (
        f"# {title}\n\n"
        f"- Source: {source_url}\n"
        f"- Fetched: {fetched_at}\n"
        f"- Last updated on docs site: {last_updated}\n\n"
        f"> Extracted snapshot from docs.pencil.dev for local Pencil reference.\n\n"
        f"{body}"
    )
    metadata = {
        "route": route,
        "title": title,
        "source_url": source_url,
        "fetched_at": fetched_at,
        "last_updated": last_updated,
    }
    return page_text, metadata


def route_to_output_path(route: str) -> Path:
    if route == "/":
        return PAGES_ROOT / "index.md"
    return PAGES_ROOT / route.strip("/") / "index.md"


def clean_pages_root() -> None:
    if PAGES_ROOT.exists():
        for child in PAGES_ROOT.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    PAGES_ROOT.mkdir(parents=True, exist_ok=True)


def write_lines(path: Path, lines: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(lines), encoding="utf-8")


def main() -> int:
    fetched_at = datetime.now(timezone.utc).isoformat()
    try:
        index_html = fetch_html(DOCS_ROOT)
        routes = discover_routes(index_html)
    except (HTTPError, URLError, RuntimeError) as error:
        print(f"Failed to discover Pencil docs routes: {error}", file=sys.stderr)
        return 1

    clean_pages_root()
    manifest_pages: list[dict] = []

    for route in routes:
        url = f"{DOCS_ROOT}{route}"
        try:
            html = fetch_html(url)
            page_text, metadata = extract_page_snapshot(route, html, fetched_at)
        except Exception as error:  # noqa: BLE001
            print(f"Failed to sync {url}: {error}", file=sys.stderr)
            return 1

        output_path = route_to_output_path(route)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(page_text, encoding="utf-8")
        metadata["output_path"] = str(output_path.relative_to(OUTPUT_ROOT))
        manifest_pages.append(metadata)

    manifest = {
        "source_root": DOCS_ROOT,
        "fetched_at": fetched_at,
        "page_count": len(manifest_pages),
        "pages": manifest_pages,
    }
    (OUTPUT_ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    write_lines(OUTPUT_ROOT / "routes.txt", (page["route"] + "\n" for page in manifest_pages))
    print(f"Synced {len(manifest_pages)} Pencil docs pages into {OUTPUT_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
