"""Unit tests for the RAG chunker — pure functions, no Postgres or OpenAI needed."""

from app.rag.chunking import UnsupportedDocumentError, chunk_text, extract_text


def test_chunk_text_respects_size_and_returns_nonempty():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 40 for i in range(20))
    chunks = chunk_text(text, chunk_chars=400, overlap=50)
    assert len(chunks) > 1
    assert all(chunk.strip() for chunk in chunks)
    # A little slack for the paragraph that tips a chunk over the limit before it's flushed.
    assert all(len(chunk) <= 400 + 300 for chunk in chunks)


def test_chunk_text_hard_splits_an_oversized_paragraph():
    chunks = chunk_text("x" * 5000, chunk_chars=1000, overlap=100)
    assert len(chunks) >= 5


def test_chunk_text_empty_input():
    assert chunk_text("   \n\n  ") == []


def test_extract_text_plain_and_markdown():
    assert "hello" in extract_text("notes.txt", "text/plain", b"hello world")
    assert "Heading" in extract_text("readme.md", "text/markdown", b"# Heading\n\nbody")


def test_extract_text_rejects_binary():
    try:
        extract_text("logo.png", "image/png", b"\x89PNG\r\n\x1a\n\xff\xfe")
    except UnsupportedDocumentError:
        return
    raise AssertionError("expected UnsupportedDocumentError for a binary file")
