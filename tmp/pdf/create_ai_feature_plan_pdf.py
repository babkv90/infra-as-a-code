from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem,
    Table, TableStyle, HRFlowable, PageBreak
)
from pathlib import Path

OUT = Path('output/pdf/infraflow-genai-ai-agent-feature-plan.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = HexColor('#13213b')
BLUE = HexColor('#2563eb')
CYAN = HexColor('#06b6d4')
TEAL = HexColor('#0f766e')
GREEN = HexColor('#059669')
VIOLET = HexColor('#7c3aed')
AMBER = HexColor('#b45309')
SLATE = HexColor('#475569')
MUTED = HexColor('#64748b')
LINE = HexColor('#cbd5e1')
SOFT = HexColor('#f8fafc')
INK = HexColor('#0f172a')

styles = getSampleStyleSheet()

title_style = ParagraphStyle('TitleX', parent=styles['Title'], textColor=NAVY, fontSize=22, leading=26, spaceAfter=4)
subtitle_style = ParagraphStyle('SubtitleX', parent=styles['Normal'], textColor=MUTED, fontSize=11, leading=15, spaceAfter=18)
h1 = ParagraphStyle('H1', parent=styles['Heading1'], textColor=NAVY, fontSize=15, leading=19, spaceBefore=16, spaceAfter=6)
h2 = ParagraphStyle('H2', parent=styles['Heading2'], textColor=BLUE, fontSize=12.5, leading=16, spaceBefore=4, spaceAfter=4)
body = ParagraphStyle('BodyX', parent=styles['Normal'], textColor=INK, fontSize=10, leading=14.5, alignment=TA_LEFT, spaceAfter=6)
bullet_body = ParagraphStyle('BulletX', parent=body, spaceAfter=4)
callout_label = ParagraphStyle('CalloutLabel', parent=body, textColor=TEAL, fontSize=9, leading=12, spaceAfter=2)
footer_style = ParagraphStyle('Footer', parent=styles['Normal'], textColor=MUTED, fontSize=8, leading=10)

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
    title='InfraFlow — GenAI / AI Agent / RAG Feature Plan',
    author='InfraFlow',
    subject='Feature roadmap for GenAI, AI agent, and RAG capabilities',
)

story = []

def h_rule(color=LINE, thickness=0.6, space_before=2, space_after=10):
    story.append(Spacer(1, space_before))
    story.append(HRFlowable(width='100%', thickness=thickness, color=color))
    story.append(Spacer(1, space_after))

def bullets(items, bullet_color=SLATE):
    story.append(ListFlowable(
        [ListItem(Paragraph(item, bullet_body), bulletColor=bullet_color) for item in items],
        bulletType='bullet', start='circle', leftIndent=14, bulletFontSize=6, spaceBefore=2, spaceAfter=8,
    ))

# ---- Header ----
story.append(Paragraph('GenAI / AI Agent / RAG Feature Plan', title_style))
story.append(Paragraph('InfraFlow — a phased roadmap grounded in what already exists in the codebase, not a generic wishlist.', subtitle_style))
h_rule(color=BLUE, thickness=1.4, space_after=14)

# ---- Current state callout ----
story.append(Paragraph('CURRENT STATE — WHAT ALREADY EXISTS', callout_label))
story.append(Paragraph(
    'A RAG agent already exists in the codebase: an "AWS Well-Architected Framework" chat with source citations, '
    'full conversation history, and workspace-scoped role-based access — but it is currently disabled behind a '
    '"coming soon" gate in the dashboard. It proxies to an external FastAPI microservice '
    '(<b>RAG_API_URL</b> / <font face="Courier">/ask</font>) that is not part of this repository and is not running. '
    'No LLM API (OpenAI, Anthropic, etc.) is wired in anywhere else in the codebase. The conversation data model already '
    'captures <font face="Courier">diagramId</font> and <font face="Courier">awsAccountId</font> context, but that '
    'context is never actually used in the retrieval call today — answers are generic, not personalized to the '
    "user's own infrastructure. This gap drives most of the prioritization below.",
    body,
))
h_rule(space_after=14)

# ---- Phase 1 ----
story.append(Paragraph('Phase 1 — Finish and personalize what already exists', h1))
story.append(Paragraph(
    'The highest-leverage move is not new infrastructure — it is making the existing RAG agent actually useful.',
    body,
))
bullets([
    '<b>Ground it in the user\'s own diagram</b>, not just a static PDF. When a conversation has a diagramId, inject the '
    'current nodes/edges, active validation issues, and cost estimates into the prompt alongside retrieved '
    'Well-Architected passages, so "why is this flagged?" answers about the user\'s own VPC, not AWS in the abstract.',
    '<b>Replace the external FastAPI dependency</b> with an in-repo retrieval service (or automate standing it up) — '
    'right now the feature is invisible to anyone who does not know to run a separate Python process.',
    '<b>Wire an actual LLM</b> (Claude via the Messages API is the natural fit given the existing structured-context '
    'pattern) for generation, with the vector store handling retrieval only.',
])

# ---- Phase 2 ----
story.append(Paragraph('Phase 2 — Turn the agent from Q&amp;A into action (agentic / tool-use)', h1))
story.append(Paragraph(
    'This is where "AI agent" stops meaning "chatbot" and starts meaning something that changes the diagram.',
    body,
))
bullets([
    '<b>Tool-calling over the diagram store:</b> expose addServiceNode, updateNodeConfig, addGroupNode, and '
    'exportTerraform as callable tools. "Add a Multi-AZ RDS Postgres behind the private subnet" &#8594; the agent '
    'plans and executes; the user approves the diff before it applies, matching the existing '
    'validate-before-deploy pattern.',
    '<b>"Generate Terraform fix":</b> already a suggested-action button in the UI, not yet wired to anything real. '
    'Feed the current exportTerraform() output plus validateDiagram() issues to the LLM, get back a patch, show a diff, '
    'and let the user accept or reject each change.',
    '<b>Natural-language &#8594; diagram generation:</b> "3-tier web app with an ALB, ECS Fargate, and RDS" &#8594; the LLM '
    'emits a structured node/edge graph using the same shape as the existing templateSnapshot() builders, dropped '
    'onto the canvas as a starting point.',
])

# ---- Phase 3 ----
story.append(Paragraph('Phase 3 — Specialized agents over data already collected', h1))
story.append(Paragraph(
    'Cost, security, and drift data are already pulled into the app today — none of it is summarized by AI yet.',
    body,
))
bullets([
    '<b>Cost agent:</b> narrate getBillingRealtimeInsights trends ("EC2 spend is up 40% this week because...") instead '
    'of raw charts.',
    '<b>Security agent:</b> turn validateDiagram\'s security findings into a prioritized, plain-English remediation plan.',
    '<b>Drift agent:</b> when deployed state diverges from the diagram, explain what changed and why it matters, not '
    'just flag it.',
])

# ---- Phase 4 ----
story.append(Paragraph('Phase 4 — Latest-tech plumbing', h1))
bullets([
    '<b>Streaming responses</b> (Server-Sent Events) for the chat UI — currently request/response only.',
    '<b>Semantic search over the service palette</b> — useful once the AWS service catalog grows past what '
    'substring-match search can handle well.',
    '<b>MCP-style tool boundary</b> if the agent should be extensible by others later, rather than a hardcoded tool list.',
])

story.append(PageBreak())

# ---- Performance section ----
story.append(Paragraph('Performance (separate from AI, as requested)', h1))
story.append(Paragraph(
    'The production build has flagged this on every build this session: a main bundle of roughly 1.7&nbsp;MB, plus a '
    '1.4&nbsp;MB ELK layout chunk. Concrete fixes:',
    body,
))
bullets([
    'Lazy-load Monaco (Terraform preview), ELK, and dagre — none are needed on first paint.',
    'Code-split rarely-visited dashboard pages (Super Admin, Support) the same way.',
    'For very large diagrams (300+ nodes, a target set early in this project), add node virtualization beyond what '
    'onlyRenderVisibleElements already provides.',
    'The backend runs on Lambda — if agent responses need to feel snappy, provisioned concurrency avoids '
    'cold-start latency specifically on that request path.',
])

h_rule(space_before=10, space_after=10)

# ---- Priority summary table ----
story.append(Paragraph('At a glance', h2))
table_data = [
    ['Phase', 'Theme', 'Effort', 'Depends on'],
    ['1', 'Personalize existing RAG agent', 'Medium', 'Stand up retrieval service + LLM API key'],
    ['2', 'Agentic tool-use over the diagram', 'High', 'Phase 1 (LLM wiring)'],
    ['3', 'Specialized cost/security/drift agents', 'Medium', 'Phase 1'],
    ['4', 'Streaming, semantic search, MCP boundary', 'Medium', 'Phase 1-2'],
    ['-', 'Bundle-size / performance pass', 'Low-Medium', 'Independent — can start anytime'],
]
tbl = Table(table_data, colWidths=[16 * mm, 78 * mm, 26 * mm, 58 * mm])
tbl.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), NAVY),
    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
    ('FONTSIZE', (0, 0), (-1, -1), 8.5),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [SOFT, HexColor('#ffffff')]),
    ('GRID', (0, 0), (-1, -1), 0.5, LINE),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('TEXTCOLOR', (0, 1), (-1, -1), INK),
]))
story.append(tbl)

story.append(Spacer(1, 18))
h_rule(space_after=6)
story.append(Paragraph(
    'Generated from a direct review of the current codebase (agentApi.ts, AgentPage.tsx, agentController.js, '
    'agentResponder.js) — reflects what is actually implemented today, not aspirational planning.',
    footer_style,
))

doc.build(story)
print(f'Wrote {OUT}')
