from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Flowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
MARKDOWN_PATH = ROOT / "output" / "pdf" / "infraflow-five-day-story.md"
PDF_PATH = ROOT / "output" / "pdf" / "infraflow-five-day-story.pdf"

PAGE_W, PAGE_H = A4
LEFT = 0.58 * inch
RIGHT = 0.58 * inch
TOP = 0.54 * inch
BOTTOM = 0.54 * inch

INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
BLUE = colors.HexColor("#2563eb")
CYAN = colors.HexColor("#06b6d4")
PURPLE = colors.HexColor("#7c3aed")
EMERALD = colors.HexColor("#10b981")
AMBER = colors.HexColor("#f59e0b")
ROSE = colors.HexColor("#e11d48")
PAPER = colors.HexColor("#f8fafc")
CARD = colors.HexColor("#ffffff")
LINE = colors.HexColor("#dbe4f0")
DARK = colors.HexColor("#111827")


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "section"


def esc(value: str) -> str:
    return html.escape(value, quote=False)


def inline_markup(value: str) -> str:
    value = esc(value)
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\[([^\]]+)\]\(#([^)]+)\)", r'<link href="#\2" color="#2563eb"><u>\1</u></link>', value)
    value = re.sub(r"(https?://[^\s<]+)", r'<link href="\1" color="#2563eb"><u>\1</u></link>', value)
    return value


class OutlineDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(LEFT, BOTTOM, PAGE_W - LEFT - RIGHT, PAGE_H - TOP - BOTTOM, id="normal")
        self.addPageTemplates([PageTemplate(id="story", frames=[frame], onPage=draw_page)])

    def afterFlowable(self, flowable):
        if isinstance(flowable, BookmarkHeading):
            self.canv.bookmarkPage(flowable.bookmark)
            self.canv.addOutlineEntry(flowable.getPlainText(), flowable.bookmark, level=flowable.level, closed=False)


class BookmarkHeading(Paragraph):
    def __init__(self, text: str, style: ParagraphStyle, bookmark: str, level: int):
        super().__init__(text, style)
        self.bookmark = bookmark
        self.level = level


class HeroFlowable(Flowable):
    def __init__(self):
        super().__init__()
        self.width = PAGE_W - LEFT - RIGHT
        self.height = 7.35 * inch

    def draw(self):
        c = self.canv
        w = self.width
        h = self.height
        c.saveState()
        c.setFillColor(colors.HexColor("#07111f"))
        c.roundRect(0, 0, w, h, 28, stroke=0, fill=1)
        for idx, color in enumerate([BLUE, CYAN, PURPLE, EMERALD]):
            c.setFillColor(color)
            c.setFillAlpha(0.16)
            c.circle(w * (0.16 + idx * 0.21), h * (0.76 - (idx % 2) * 0.14), 92 - idx * 8, stroke=0, fill=1)
        c.setFillAlpha(1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 44)
        c.drawString(38, h - 115, "InfraFlow")
        c.setFillColor(colors.HexColor("#bae6fd"))
        c.setFont("Helvetica-Bold", 19)
        c.drawString(40, h - 152, "Five days from blank Terraform to deployed MVP")
        c.setFillColor(colors.HexColor("#dbeafe"))
        c.setFont("Helvetica", 12.0)
        lines = [
            "A real project story, reconstructed from the codebase, docs, and git history.",
            "Visual AWS architecture. Terraform generation.",
            "Real deployment execution. Storage lessons.",
            "GitHub Actions runners. Safety gates.",
            "Working product loop.",
        ]
        y = h - 205
        for line in lines:
            c.drawString(42, y, line)
            y -= 22
        c.setFillColor(colors.HexColor("#0ea5e9"))
        c.roundRect(42, 82, 168, 34, 17, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(126, 94, "BUILT WITH REAL AWS")
        c.setFillColor(colors.HexColor("#1f2937"))
        c.setStrokeColor(colors.HexColor("#38bdf8"))
        c.setLineWidth(1.2)
        x0, y0 = w - 240, 66
        labels = ["Canvas", "Terraform", "GitHub Actions", "AWS"]
        for i, label in enumerate(labels):
            yy = y0 + (len(labels) - i - 1) * 58
            c.setFillColor(colors.HexColor("#101827"))
            c.roundRect(x0, yy, 190, 34, 10, stroke=1, fill=1)
            c.setFillColor(colors.white)
            c.setFont("Helvetica-Bold", 10)
            c.drawString(x0 + 14, yy + 12, label)
            if i < len(labels) - 1:
                c.setStrokeColor(CYAN)
                c.line(x0 + 95, yy + 34, x0 + 95, yy + 58)
        c.restoreState()


class QuoteBox(Flowable):
    def __init__(self, text: str, accent=CYAN):
        super().__init__()
        self.text = text
        self.accent = accent
        self.width = PAGE_W - LEFT - RIGHT
        self.height = 0.82 * inch

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(colors.HexColor("#eff6ff"))
        c.setStrokeColor(colors.HexColor("#bfdbfe"))
        c.roundRect(0, 0, self.width, self.height, 14, stroke=1, fill=1)
        c.setFillColor(self.accent)
        c.roundRect(0, 0, 7, self.height, 4, stroke=0, fill=1)
        c.setFillColor(BLUE)
        c.setFont("Helvetica-Bold", 20)
        c.drawString(22, self.height - 29, "Aha")
        c.setFillColor(INK)
        c.setFont("Helvetica", 10.3)
        text = self.text
        max_chars = 92
        parts = []
        while len(text) > max_chars:
            cut = text.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            parts.append(text[:cut])
            text = text[cut:].strip()
        parts.append(text)
        y = self.height - 30
        for part in parts[:3]:
            c.drawString(74, y, part)
            y -= 14
        c.restoreState()


class StatGrid(Flowable):
    stats = [
        ("238", "tracked repo files"),
        ("166", "source files checked"),
        ("45", "AWS services in catalog"),
        ("29", "Terraform generator branches"),
        ("2", "Terraform executors"),
        ("3", "validation layers"),
        ("4", "storage bottleneck causes"),
        ("5", "MVP sprint days"),
    ]

    def __init__(self):
        super().__init__()
        self.width = PAGE_W - LEFT - RIGHT
        self.height = 2.15 * inch

    def draw(self):
        c = self.canv
        c.saveState()
        col_w = self.width / 4
        row_h = self.height / 2
        for i, (number, label) in enumerate(self.stats):
            col = i % 4
            row = 1 - (i // 4)
            x = col * col_w + 5
            y = row * row_h + 5
            c.setFillColor(CARD)
            c.setStrokeColor(LINE)
            c.roundRect(x, y, col_w - 10, row_h - 10, 12, stroke=1, fill=1)
            c.setFillColor([BLUE, PURPLE, CYAN, EMERALD, AMBER, ROSE, BLUE, PURPLE][i])
            c.setFont("Helvetica-Bold", 24)
            c.drawCentredString(x + (col_w - 10) / 2, y + row_h - 42, number)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 8.5)
            c.drawCentredString(x + (col_w - 10) / 2, y + 22, label)
        c.restoreState()


class TimelineFlowable(Flowable):
    items = [
        ("Day 1", "The first spine", "React, Express, MongoDB, Terraform, first deploy loop."),
        ("Day 2", "Canvas to compiler", "Nodes, edges, validation, export, deployment modal."),
        ("Day 3", "Execution boundaries", "Lambda zip upload, IAM permissions, real AWS debugging."),
        ("Day 4", "Runner scale", "Storage adapter, S3 artifacts, GitHub Actions executor."),
        ("Day 5", "MVP platform", "Pipelines, OIDC, notifications, CloudFront/API Gateway hardening."),
    ]

    def __init__(self):
        super().__init__()
        self.width = PAGE_W - LEFT - RIGHT
        self.height = 4.25 * inch

    def draw(self):
        c = self.canv
        c.saveState()
        x = 46
        c.setStrokeColor(CYAN)
        c.setLineWidth(3)
        c.line(x, 24, x, self.height - 24)
        colors_cycle = [BLUE, CYAN, PURPLE, EMERALD, AMBER]
        step = (self.height - 56) / 4
        for i, (day, title, text) in enumerate(self.items):
            y = self.height - 28 - i * step
            c.setFillColor(colors_cycle[i])
            c.circle(x, y, 11, stroke=0, fill=1)
            c.setFillColor(CARD)
            c.setStrokeColor(LINE)
            c.roundRect(x + 30, y - 36, self.width - x - 42, 70, 14, stroke=1, fill=1)
            c.setFillColor(colors_cycle[i])
            c.setFont("Helvetica-Bold", 11)
            c.drawString(x + 48, y + 12, day)
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 12)
            c.drawString(x + 105, y + 12, title)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 9.3)
            c.drawString(x + 48, y - 11, text)
        c.restoreState()


class CodeBlock(Flowable):
    def __init__(self, code: str):
        super().__init__()
        self.code = code.strip("\n")
        self.width = PAGE_W - LEFT - RIGHT
        self.lines = self.code.splitlines()
        self.height = max(0.65 * inch, 0.23 * inch + len(self.lines) * 12.5)

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(DARK)
        c.roundRect(0, 0, self.width, self.height, 10, stroke=0, fill=1)
        y = self.height - 20
        for line in self.lines:
            draw_code_line(c, line[:104], 16, y)
            y -= 12.5
        c.restoreState()


def draw_code_line(c, line: str, x: float, y: float):
    tokens = re.split(r'("[^"]*"|\'[^\']*\'|\\b(?:class|async|return|if|const|await|function|Action|Effect|Principal|Condition)\\b)', line)
    cursor = x
    c.setFont("Courier", 7.6)
    for token in tokens:
        if not token:
            continue
        if token.startswith('"') or token.startswith("'"):
            color = colors.HexColor("#86efac")
        elif re.match(r"\\b(class|async|return|if|const|await|function|Action|Effect|Principal|Condition)\\b", token):
            color = colors.HexColor("#93c5fd")
        else:
            color = colors.HexColor("#e5e7eb")
        c.setFillColor(color)
        c.drawString(cursor, y, token)
        cursor += stringWidth(token, "Courier", 7.6)


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    if doc.page > 1:
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(LEFT, 0.32 * inch, "InfraFlow - Five days from blank Terraform to deployed MVP")
        canvas.drawRightString(PAGE_W - RIGHT, 0.32 * inch, f"{doc.page}")
        canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
        canvas.line(LEFT, 0.48 * inch, PAGE_W - RIGHT, 0.48 * inch)
    canvas.restoreState()


def make_styles():
    base = getSampleStyleSheet()
    styles = {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=INK, spaceBefore=16, spaceAfter=9),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=BLUE, spaceBefore=12, spaceAfter=7),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=9.6, leading=13.6, textColor=INK, spaceAfter=6),
        "toc": ParagraphStyle("toc", parent=base["BodyText"], fontName="Helvetica", fontSize=10.3, leading=15.5, textColor=INK, spaceAfter=5),
        "li": ParagraphStyle("li", parent=base["BodyText"], fontName="Helvetica", fontSize=9.3, leading=12.8, textColor=INK),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontName="Helvetica", fontSize=8.2, leading=11, textColor=MUTED, spaceAfter=5),
        "center": ParagraphStyle("center", parent=base["BodyText"], alignment=TA_CENTER, fontName="Helvetica", fontSize=10, leading=13, textColor=MUTED),
    }
    return styles


@dataclass
class Section:
    title: str
    level: int
    anchor: str


def parse_markdown(markdown: str):
    lines = markdown.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            lang = line.strip("`").strip()
            i += 1
            code = []
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", lang, "\n".join(code)))
            continue
        if line.startswith("# "):
            blocks.append(("h1", line[2:].strip()))
            i += 1
            continue
        if line.startswith("## "):
            blocks.append(("h2", line[3:].strip()))
            i += 1
            continue
        if line.startswith("> "):
            quote = [line[2:].strip()]
            i += 1
            while i < len(lines) and lines[i].startswith("> "):
                quote.append(lines[i][2:].strip())
                i += 1
            blocks.append(("quote", " ".join(quote)))
            continue
        if line.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:].strip())
                i += 1
            blocks.append(("list", items))
            continue
        para = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(("# ", "## ", "- ", "> ", "```")):
            para.append(lines[i].strip())
            i += 1
        blocks.append(("p", " ".join(para)))
    return blocks


def build_story(markdown: str):
    styles = make_styles()
    story = [HeroFlowable(), PageBreak()]
    sections: list[Section] = []
    code_count = 0
    for block in parse_markdown(markdown):
        kind = block[0]
        if kind in {"h1", "h2"}:
            title = block[1]
            anchor = slugify(title)
            level = 0 if kind == "h1" else 1
            sections.append(Section(title, level, anchor))
            if title in {"By The Numbers"}:
                story.append(PageBreak())
            if title in {"The Five Days"}:
                story.append(PageBreak())
            story.append(BookmarkHeading(inline_markup(title), styles[kind], anchor, level))
            if title == "By The Numbers":
                story.append(Spacer(1, 8))
                story.append(StatGrid())
                story.append(Spacer(1, 10))
            if title == "The Five Days":
                story.append(Spacer(1, 8))
                story.append(TimelineFlowable())
                story.append(Spacer(1, 10))
            continue
        if kind == "p":
            text = block[1]
            if text.startswith("Aha:"):
                story.append(Spacer(1, 5))
                story.append(QuoteBox(text.replace("Aha:", "").strip()))
                story.append(Spacer(1, 6))
            elif text in {"You did not just build screens.", "You built a working infrastructure product."}:
                story.append(Paragraph(f"<b>{inline_markup(text)}</b>", ParagraphStyle("closing", parent=styles["h1"], alignment=TA_CENTER, textColor=BLUE, fontSize=20, leading=24, spaceBefore=10, spaceAfter=10)))
            else:
                story.append(Paragraph(inline_markup(text), styles["body"]))
            continue
        if kind == "quote":
            story.append(QuoteBox(block[1], accent=PURPLE))
            story.append(Spacer(1, 8))
            continue
        if kind == "list":
            list_items = [ListItem(Paragraph(inline_markup(item), styles["li"]), leftIndent=12) for item in block[1]]
            story.append(ListFlowable(list_items, bulletType="bullet", leftIndent=14, bulletFontName="Helvetica", bulletFontSize=7))
            story.append(Spacer(1, 5))
            continue
        if kind == "code":
            code_count += 1
            story.append(Spacer(1, 5))
            story.append(CodeBlock(block[2]))
            story.append(Spacer(1, 9))
            continue
    return story, sections


def main():
    markdown = MARKDOWN_PATH.read_text(encoding="utf-8")
    story, _sections = build_story(markdown)
    doc = OutlineDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title="InfraFlow: Five days from blank Terraform to deployed MVP",
        author="InfraFlow",
    )
    doc.build(story)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
