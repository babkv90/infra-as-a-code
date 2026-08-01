from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.utils import simpleSplit
from pathlib import Path
import math

OUT = Path('output/pdf/infraflow-self-deploying-architecture.pdf')
W, H = landscape(A4)

NAVY = HexColor('#13213b')
BLUE = HexColor('#2563eb')
CYAN = HexColor('#06b6d4')
TEAL = HexColor('#0f766e')
GREEN = HexColor('#059669')
VIOLET = HexColor('#7c3aed')
AMBER = HexColor('#f59e0b')
ORANGE = HexColor('#ea580c')
RED = HexColor('#dc2626')
SLATE = HexColor('#475569')
MUTED = HexColor('#64748b')
LINE = HexColor('#cbd5e1')
SOFT = HexColor('#f8fafc')
BLUE_SOFT = HexColor('#eff6ff')
CYAN_SOFT = HexColor('#ecfeff')
GREEN_SOFT = HexColor('#ecfdf5')
VIOLET_SOFT = HexColor('#f5f3ff')
AMBER_SOFT = HexColor('#fffbeb')
INK = HexColor('#0f172a')

c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle('Infraflow Self Deploying Architecture')
c.setAuthor('Infraflow / Codex')
c.setSubject('Visual deployment architecture and pipeline diagram')
c.setCreator('Codex generated ReportLab PDF')

sources = [
    'README.md', 'docs/HLD.md', '.github/workflows/infraflow-development-deploy.yml',
    '.github/workflows/terraform-validate.yml', '.github/workflows/terraform-deploy.yml',
    'IAAS backend/src/app.js', 'IAAS backend/src/lambda.js', 'IAAS backend/src/routes/index.js'
]


def rounded_rect(x, y, w, h, fill=SOFT, stroke=LINE, radius=14, sw=1):
    c.setLineWidth(sw)
    c.setStrokeColor(stroke)
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def arrow(x1, y1, x2, y2, color=BLUE, width=1.7, label=None, label_offset=7, dash=None):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setDash(*(dash or []))
    c.line(x1, y1, x2, y2)
    c.setDash()
    angle = math.atan2(y2-y1, x2-x1)
    size = 8
    p1 = (x2 - size*math.cos(angle-math.pi/6), y2 - size*math.sin(angle-math.pi/6))
    p2 = (x2 - size*math.cos(angle+math.pi/6), y2 - size*math.sin(angle+math.pi/6))
    c.setStrokeColor(color)
    c.line(x2, y2, p1[0], p1[1])
    c.line(x2, y2, p2[0], p2[1])
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        tw = stringWidth(label, 'Helvetica', 7.5) + 10
        rounded_rect(mx - tw/2, my + label_offset, tw, 14, fill=colors.white, stroke=HexColor('#e2e8f0'), radius=7, sw=.6)
        c.setFillColor(SLATE)
        c.setFont('Helvetica', 7.5)
        c.drawCentredString(mx, my + label_offset + 4, label)


def text(x, y, s, size=10, color=INK, font='Helvetica', max_width=None, leading=None):
    c.setFillColor(color)
    c.setFont(font, size)
    if max_width:
        lines = simpleSplit(s, font, size, max_width)
        ly = y
        for part in lines:
            c.drawString(x, ly, part)
            ly -= leading or size * 1.25
        return ly
    c.drawString(x, y, s)
    return y - (leading or size * 1.25)


def centered(x, y, s, size=10, color=INK, font='Helvetica-Bold'):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawCentredString(x, y, s)


def card(x, y, w, h, title, body=None, fill=SOFT, accent=BLUE, tag=None):
    rounded_rect(x, y, w, h, fill=fill, stroke=HexColor('#dbe4ef'), radius=16, sw=1)
    c.setFillColor(accent)
    c.roundRect(x+10, y+h-14, 38, 4, 2, fill=1, stroke=0)
    if tag:
        tw = stringWidth(tag, 'Helvetica-Bold', 7.2) + 14
        rounded_rect(x+w-tw-12, y+h-33, tw, 17, fill=colors.white, stroke=HexColor('#d7e1ef'), radius=8, sw=.7)
        centered(x+w-tw/2-12, y+h-28, tag, 7.2, accent, 'Helvetica-Bold')
    title_width = w - 28 - (stringWidth(tag, 'Helvetica-Bold', 7.2) + 28 if tag else 0)
    title_lines = simpleSplit(title, 'Helvetica-Bold', 10.6, max(50, title_width))
    title_y = y + h - 30
    for part in title_lines[:2]:
        text(x+14, title_y, part, 10.6, NAVY, 'Helvetica-Bold')
        title_y -= 11
    if body:
        body_y = y+h-50 if len(title_lines) <= 1 else y+h-60
        text(x+14, body_y, body, 7.7, SLATE, 'Helvetica', max_width=w-28, leading=9.4)


def section_title(title, subtitle=None):
    text(34, H-42, title, 24, NAVY, 'Helvetica-Bold')
    if subtitle:
        text(36, H-62, subtitle, 9.5, MUTED, 'Helvetica', max_width=W-72, leading=12)
    c.setStrokeColor(HexColor('#e2e8f0'))
    c.setLineWidth(1)
    c.line(34, H-74, W-34, H-74)


def footer(page):
    c.setFillColor(MUTED)
    c.setFont('Helvetica', 7.5)
    c.drawString(34, 24, 'Sources reviewed: ' + ', '.join(sources[:4]) + ' ...')
    c.drawRightString(W-34, 24, f'Infraflow architecture PDF - page {page}')


def draw_pipeline_bar(y):
    stages = [('1', 'Design', 'ReactFlow canvas'), ('2', 'Validate', 'diagram + HCL + Terraform'), ('3', 'Plan', 'cost/risk preview'), ('4', 'Apply', 'AWS resources'), ('5', 'Observe', 'logs + inventory')]
    x = 70
    for idx, title, sub in stages:
        rounded_rect(x, y, 118, 52, fill=colors.white, stroke=HexColor('#d8e2f0'), radius=16, sw=1)
        rounded_rect(x+10, y+17, 22, 22, fill=BLUE_SOFT, stroke=HexColor('#bfdbfe'), radius=11, sw=.8)
        centered(x+21, y+24, idx, 9, BLUE, 'Helvetica-Bold')
        text(x+40, y+31, title, 10, NAVY, 'Helvetica-Bold')
        text(x+40, y+18, sub, 7.6, MUTED, max_width=70)
        if x < 70 + 4*142:
            arrow(x+120, y+26, x+140, y+26, color=CYAN, width=1.5)
        x += 142

# Page 1
section_title('Infraflow Self-Deploying Architecture', 'Interactive-style visual map of how this application is hosted, operated, and used to deploy infrastructure through its own pipeline.')
c.setStrokeColor(HexColor('#eef2f7')); c.setLineWidth(.4)
for gx in range(40, int(W-30), 42): c.line(gx, 60, gx, H-92)
for gy in range(62, int(H-88), 32): c.line(34, gy, W-34, gy)
card(54, 390, 150, 78, 'Developer Loop', 'Codex and Claude assisted implementation, local Vite/Node dev, build checks, repo updates.', fill=VIOLET_SOFT, accent=VIOLET, tag='BUILD')
card(250, 390, 150, 78, 'GitHub Repository', 'React frontend, Express backend, shared AWS resource registry, docs, and workflow files.', fill=BLUE_SOFT, accent=BLUE, tag='SOURCE')
card(450, 390, 160, 78, 'GitHub Actions', 'Manual environment deploy, Node 20 build, tests when present, OIDC AWS credentials.', fill=CYAN_SOFT, accent=CYAN, tag='CI/CD')
card(660, 390, 140, 78, 'AWS Deploy Role', 'Repository secret points to role ARN. OIDC issues short-lived credentials.', fill=AMBER_SOFT, accent=AMBER, tag='IAM')
arrow(204, 430, 250, 430, VIOLET, label='push')
arrow(400, 430, 450, 430, BLUE, label='workflow_dispatch')
arrow(610, 430, 660, 430, CYAN, label='assume role')
card(70, 250, 165, 82, 'CloudFront + S3', 'Vite build output is synced to S3 and CloudFront is invalidated for the public SPA.', fill=BLUE_SOFT, accent=BLUE, tag='FRONTEND')
card(335, 250, 170, 82, 'API Gateway + Lambda', 'Express app is wrapped by serverless-http. Lambda connects MongoDB and reconciles interrupted deployments on cold start.', fill=GREEN_SOFT, accent=GREEN, tag='API')
card(600, 250, 165, 82, 'MongoDB Atlas', 'Users, workspaces, AWS accounts, diagrams, deployments, agent conversations, audit logs.', fill=VIOLET_SOFT, accent=VIOLET, tag='DATA')
arrow(520, 390, 190, 332, CYAN, label='static deploy')
arrow(730, 390, 420, 332, AMBER, label='backend target', dash=(4,2))
arrow(505, 292, 600, 292, GREEN, label='mongoose')
card(68, 122, 180, 74, 'User Browser', 'Landing page, auth, dashboard, AWS insights, visual builder, pipelines, support, admin.', fill=colors.white, accent=NAVY)
card(333, 122, 180, 74, 'Connected AWS Account', 'Infraflow assumes the customer role for sync, validation, apply, destroy, and inventory.', fill=AMBER_SOFT, accent=ORANGE)
card(595, 122, 182, 74, 'GitHub Terraform Runner', 'Generated main.tf can be pushed to the repo and run via validate/deploy workflows.', fill=CYAN_SOFT, accent=CYAN)
arrow(150, 250, 150, 196, BLUE, label='serve SPA')
arrow(248, 159, 335, 292, GREEN, label='/api/v1')
arrow(505, 159, 595, 159, CYAN, label='dispatch')
arrow(685, 196, 503, 250, AMBER, label='callbacks')
arrow(422, 250, 420, 196, GREEN, label='sts + AWS SDK')
draw_pipeline_bar(68)
footer(1)
c.showPage()

# Page 2
section_title('Runtime Request Flow', 'The deployed application separates the static SPA, serverless API, database state, and external cloud systems.')
card(42, 414, 126, 72, 'Browser', 'Authenticated user interacts with dashboard, builder, AWS insights, and pipeline pages.', fill=colors.white, accent=NAVY)
card(214, 414, 140, 72, 'CloudFront CDN', 'Caches and serves the Vite React static build from S3.', fill=BLUE_SOFT, accent=BLUE)
card(402, 414, 132, 72, 'S3 Static Site', 'Stores dist/ assets created by npm run build.', fill=BLUE_SOFT, accent=CYAN)
card(600, 414, 166, 72, 'React SPA', 'Routes: overview, visual builder, deployments, resource info, infra pipeline, app pipeline, AI agent.', fill=VIOLET_SOFT, accent=VIOLET)
arrow(168, 450, 214, 450, BLUE, label='HTTPS')
arrow(354, 450, 402, 450, CYAN, label='origin')
arrow(534, 450, 600, 450, VIOLET, label='assets')
card(88, 282, 164, 84, 'API Gateway', 'Receives /api/v1 requests and forwards them to the serverless Express handler.', fill=GREEN_SOFT, accent=GREEN)
card(336, 282, 176, 84, 'Lambda Express API', 'Helmet, CORS, rate limit, auth middleware, route modules, error handling.', fill=GREEN_SOFT, accent=TEAL)
card(608, 282, 152, 84, 'MongoDB', 'Workspace-scoped persistent state and deployment lifecycle logs.', fill=VIOLET_SOFT, accent=VIOLET)
arrow(666, 414, 222, 366, GREEN, label='/api/v1')
arrow(252, 324, 336, 324, GREEN, label='proxy')
arrow(512, 324, 608, 324, VIOLET, label='read/write')
card(40, 138, 142, 82, 'Auth + RBAC', 'JWT access tokens, httpOnly refresh token, workspace roles, protected routes.', fill=colors.white, accent=NAVY)
card(220, 138, 142, 82, 'AWS Sync', 'STS, Cost Explorer, EC2, Lambda, S3, RDS, CloudWatch, CloudTrail, IAM.', fill=AMBER_SOFT, accent=ORANGE)
card(400, 138, 142, 82, 'Terraform Engine', 'Generator, validation gate, local or GitHub runner, logs, status updates.', fill=CYAN_SOFT, accent=CYAN)
card(580, 138, 142, 82, 'App Pipeline', 'Generates GitHub Actions workflow, Dockerfile, deploy manifest, and OIDC deploy role.', fill=BLUE_SOFT, accent=BLUE)
arrow(424, 282, 111, 220, NAVY, label='auth')
arrow(424, 282, 291, 220, ORANGE, label='assume role')
arrow(424, 282, 471, 220, CYAN, label='deploy')
arrow(424, 282, 651, 220, BLUE, label='generate CI/CD')
x = 56; y = 84
routes = ['/auth', '/dashboard', '/diagrams', '/deployments', '/aws', '/agent', '/app-pipelines', '/github', '/notifications', '/tickets']
for r in routes:
    tw = stringWidth(r, 'Helvetica-Bold', 8) + 18
    rounded_rect(x, y, tw, 21, fill=colors.white, stroke=HexColor('#dbe4ef'), radius=10, sw=.7)
    centered(x+tw/2, y+7, r, 8, SLATE, 'Helvetica-Bold')
    x += tw + 9
    if x > W-100:
        x = 56; y -= 28
text(56, 58, 'Route surface extracted from IAAS backend/src/routes/index.js.', 8, MUTED)
footer(2)
c.showPage()

# Page 3
section_title('Infrastructure Deployment Flow', 'The visual builder turns a diagram into Terraform, then applies it only after repeated gates pass.')
steps = [
    ('1. Canvas', 'ReactFlow nodes and edges. Connections become Terraform references, not just visual links.', VIOLET, VIOLET_SOFT),
    ('2. Client Check', 'Missing fields, invalid ARNs, dangling edges, and risky security group rules surface early.', BLUE, BLUE_SOFT),
    ('3. Backend Plan', 'Server validates again, generates HCL, checks structure, and creates a Deployment record.', GREEN, GREEN_SOFT),
    ('4. Terraform Validate', 'Local Terraform CLI or GitHub Actions validates generated main.tf against provider schemas.', CYAN, CYAN_SOFT),
    ('5. Plan + Apply', 'Terraform init, plan, apply or destroy run with short-lived AWS session credentials.', ORANGE, AMBER_SOFT),
    ('6. Observe', 'Logs, status, outputs, resource inventory, drift checks, and safe teardown flow back to dashboard.', NAVY, colors.white),
]
x0, y0 = 46, 400
for i, (title, body, accent, fill) in enumerate(steps):
    row = 0 if i < 3 else 1
    col = i if i < 3 else i - 3
    x = x0 + col * 262
    y = y0 - row * 190
    card(x, y, 210, 92, title, body, fill=fill, accent=accent)
    if col < 2:
        arrow(x+210, y+46, x+250, y+46, accent)
    elif row == 0:
        arrow(x+105, y, x+105, y-88, accent)
    elif col > 0:
        arrow(x-52, y+46, x-12, y+46, accent)
rounded_rect(60, 70, W-120, 86, fill=HexColor('#f8fbff'), stroke=HexColor('#dbeafe'), radius=20, sw=1)
text(82, 130, 'Deployment safety gates', 13, NAVY, 'Helvetica-Bold')
gates = [('Workspace isolation', GREEN), ('Diagram validation', BLUE), ('Generated HCL check', CYAN), ('terraform validate', VIOLET), ('terraform plan', ORANGE), ('Auto cleanup on failed first apply', RED)]
gx = 82
for name, color in gates:
    tw = stringWidth(name, 'Helvetica-Bold', 8) + 18
    rounded_rect(gx, 95, tw, 22, fill=colors.white, stroke=color, radius=11, sw=1)
    centered(gx+tw/2, 102, name, 8, color, 'Helvetica-Bold')
    gx += tw + 12
text(82, 79, 'Executor options include local backend runner and GitHub-hosted Terraform workflows. Sensitive outputs can be moved behind Secrets Manager references.', 8, MUTED, max_width=W-160)
footer(3)
c.showPage()

# Page 4
section_title('Self-Pipeline and Ownership Model', 'How Infraflow deploys itself and how it provisions infrastructure for users without storing AWS keys.')
lanes = [('Codex / Claude Assisted Changes', 446, VIOLET_SOFT, VIOLET), ('GitHub Source + Actions', 342, BLUE_SOFT, BLUE), ('Infraflow Hosted Runtime', 238, GREEN_SOFT, GREEN), ('Customer Cloud Runtime', 134, AMBER_SOFT, ORANGE)]
for name, y, fill, accent in lanes:
    rounded_rect(40, y, W-80, 70, fill=fill, stroke=HexColor('#dbe4ef'), radius=18, sw=1)
    text(60, y+43, name, 12, NAVY, 'Helvetica-Bold')
    c.setFillColor(accent); c.circle(50, y+48, 5, fill=1, stroke=0)
card(270, 455, 138, 48, 'Local Build', 'npm run build and backend checks.', fill=colors.white, accent=VIOLET)
card(470, 455, 158, 48, 'Repo Changes', 'React, Express, docs, workflows.', fill=colors.white, accent=VIOLET)
arrow(408, 479, 470, 479, VIOLET)
card(250, 351, 148, 48, 'Workflow Dispatch', 'environment selected manually.', fill=colors.white, accent=BLUE)
card(452, 351, 158, 48, 'Build + Scan', 'Node 20, npm ci, optional tests, Vite build.', fill=colors.white, accent=BLUE)
card(670, 351, 132, 48, 'OIDC Login', 'Assume AWS deploy role.', fill=colors.white, accent=BLUE)
arrow(398, 375, 452, 375, BLUE)
arrow(610, 375, 670, 375, BLUE)
card(230, 247, 154, 48, 'Static Frontend', 'S3 sync and CloudFront invalidate.', fill=colors.white, accent=GREEN)
card(454, 247, 154, 48, 'Serverless API', 'Express Lambda behind API Gateway.', fill=colors.white, accent=GREEN)
card(672, 247, 132, 48, 'State Services', 'MongoDB and secrets broker.', fill=colors.white, accent=GREEN)
arrow(736, 351, 310, 295, GREEN, label='deploy assets')
arrow(736, 351, 531, 295, GREEN, label='backend target', dash=(4,2))
card(210, 143, 150, 48, 'AWS Role Setup', 'Trust policy and permissions policy shown to users with masked ARN.', fill=colors.white, accent=ORANGE)
card(414, 143, 155, 48, 'Generated Terraform', 'Resource graph produces main.tf.', fill=colors.white, accent=ORANGE)
card(632, 143, 165, 48, 'GitHub Terraform Jobs', 'Validate, plan, apply, destroy, callback.', fill=colors.white, accent=ORANGE)
arrow(360, 167, 414, 167, ORANGE)
arrow(569, 167, 632, 167, ORANGE)
arrow(531, 247, 492, 191, GREEN, label='deploy request')
arrow(715, 143, 715, 238, ORANGE, label='status callback')
rounded_rect(54, 55, W-108, 48, fill=HexColor('#fff7ed'), stroke=HexColor('#fed7aa'), radius=18, sw=1)
text(76, 82, 'Important current-state note', 11, ORANGE, 'Helvetica-Bold')
text(76, 68, 'The repository includes Lambda entrypoint code and docs describing API Gateway + Lambda hosting. The inspected development deploy workflow clearly deploys the static frontend to S3/CloudFront and prepares AWS OIDC credentials; backend Lambda update should be verified before production release if not already handled elsewhere.', 8.2, SLATE, max_width=W-150, leading=10)
footer(4)
c.showPage()

c.save()
print(OUT)
