#!/usr/bin/env python3
"""Rebuild Got 1.pdf for compact A4 printing: TNR 12 body, 14 bold headings."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

import pymupdf
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

INPUT_PDF = Path("/Users/nithin.k/Downloads/Got 1.pdf")
OUTPUT_PDF = Path("/Users/nithin.k/Downloads/Got 1-print-optimized.pdf")

HEADINGS = {
    "PROLOGUE",
    "EPILOGUE",
    "ARYA",
    "BRAN",
    "CATELYN",
    "DAENERYS",
    "EDDARD",
    "JON",
    "SANSA",
    "TYRION",
}
HEADER_FOOTER = "previous | Table of Contents | next"
TEXT_START_PAGE = 5  # 0-based; page 6 is PROLOGUE


def clean_lines(doc: pymupdf.Document) -> list[str]:
    lines: list[str] = []
    for i in range(TEXT_START_PAGE, doc.page_count):
        for line in doc[i].get_text().splitlines():
            line = line.strip()
            if not line or line == HEADER_FOOTER:
                continue
            if re.fullmatch(r"\d+", line):
                continue
            if line.startswith("G Chapter"):
                continue
            lines.append(line)
    return lines


def reflow(lines: list[str]) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf.strip():
            items.append(("body", buf.strip()))
        buf = ""

    for line in lines:
        if line in HEADINGS:
            flush()
            items.append(("heading", line))
            continue
        if not buf:
            buf = line
            continue
        if buf.endswith("-"):
            buf = buf[:-1] + line
        elif line[0] in "\"“‘(" or (
            buf[-1] not in ".?!:;\"”\'" and not buf.endswith("...")
        ):
            buf += " " + line
        else:
            flush()
            buf = line
    flush()
    return items


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def build_pdf(items: list[tuple[str, str]], path: Path) -> None:
  margin = 1.0 * cm
  doc = SimpleDocTemplate(
      str(path),
      pagesize=A4,
      leftMargin=margin,
      rightMargin=margin,
      topMargin=margin,
      bottomMargin=margin,
      title="A Game of Thrones (print optimized)",
      author="George R.R. Martin",
  )

  body = ParagraphStyle(
      "Body",
      fontName="Times-Roman",
      fontSize=12,
      leading=12,
      alignment=TA_JUSTIFY,
      spaceBefore=0,
      spaceAfter=0,
      firstLineIndent=0,
  )
  heading = ParagraphStyle(
      "Heading",
      fontName="Times-Bold",
      fontSize=14,
      leading=15,
      spaceBefore=4,
      spaceAfter=2,
  )
  title = ParagraphStyle(
      "Title",
      fontName="Times-Bold",
      fontSize=14,
      leading=16,
      spaceAfter=4,
      alignment=TA_JUSTIFY,
  )

  story: list = [
      Paragraph(esc("A GAME OF THRONES"), title),
      Paragraph(esc("Book One of A Song of Ice and Fire"), body),
      Paragraph(esc("George R.R. Martin"), body),
      Spacer(1, 6),
  ]

  for kind, text in items:
      style = heading if kind == "heading" else body
      # Avoid reportlab splitting issues on empty
      if not text:
          continue
      story.append(Paragraph(esc(text), style))

  doc.build(story)


def main() -> int:
    if not INPUT_PDF.is_file():
        print(f"Missing input: {INPUT_PDF}", file=sys.stderr)
        return 1

    print(f"Reading {INPUT_PDF} …")
    pdf = pymupdf.open(INPUT_PDF)
    lines = clean_lines(pdf)
    items = reflow(lines)
    pdf.close()
    print(f"Reflowed {len(lines)} lines → {len(items)} blocks")

    print(f"Writing {OUTPUT_PDF} …")
    build_pdf(items, OUTPUT_PDF)

    out = pymupdf.open(OUTPUT_PDF)
    n = out.page_count
    out.close()
    print(f"Done: {n} pages (source had 755 pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
