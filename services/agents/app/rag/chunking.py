"""Turn an uploaded file's bytes into overlapping plain-text chunks ready for embedding."""

from __future__ import annotations

import io

from app.config import settings

_PDF_TYPES = {"application/pdf"}
_TEXT_SUFFIXES = (".md", ".markdown", ".txt", ".text", ".rst", ".csv", ".json", ".yaml", ".yml")


class UnsupportedDocumentError(ValueError):
    """The file isn't a PDF or a recognised text format."""


def extract_text(filename: str, content_type: str, data: bytes) -> str:
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if ctype in _PDF_TYPES or name.endswith(".pdf"):
        return _extract_pdf(data)

    if ctype.startswith("text/") or name.endswith(_TEXT_SUFFIXES):
        return data.decode("utf-8", errors="replace")

    # Last resort: if it decodes cleanly as UTF-8 and looks like text, accept it.
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnsupportedDocumentError(
            f"Unsupported document type for {filename!r} ({content_type or 'unknown'}). Upload a PDF or a UTF-8 text/markdown file."
        ) from exc
    return text


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader  # local import: only ingestion needs it, keeps cold start lean

    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001 — a single unreadable page shouldn't sink the whole doc
            continue
    return "\n\n".join(parts)


def chunk_text(text: str, *, chunk_chars: int | None = None, overlap: int | None = None) -> list[str]:
    """Paragraph-aware sliding window: pack whole paragraphs up to chunk_chars, then start the next
    chunk `overlap` characters back so a sentence split across the boundary still lands intact in
    one chunk."""
    size = int(chunk_chars or settings.rag_chunk_chars)
    lap = int(overlap or settings.rag_chunk_overlap)
    normalised = "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").split("\n"))
    paragraphs = [p.strip() for p in normalised.split("\n\n") if p.strip()]

    chunks: list[str] = []
    buf = ""
    for para in paragraphs:
        candidate = f"{buf}\n\n{para}".strip() if buf else para
        if len(candidate) <= size or not buf:
            buf = candidate
        else:
            chunks.append(buf)
            tail = buf[-lap:] if lap and len(buf) > lap else ""
            buf = f"{tail}\n\n{para}".strip() if tail else para
        # A single paragraph longer than the window: hard-split it.
        while len(buf) > size:
            chunks.append(buf[:size])
            buf = buf[max(0, size - lap):]
    if buf.strip():
        chunks.append(buf.strip())
    return [c for c in chunks if c.strip()]
