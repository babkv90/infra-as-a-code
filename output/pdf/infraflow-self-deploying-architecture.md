# Infraflow Self-Deploying Architecture

_Interactive-style visual map of how this application is hosted, operated, and used to deploy infrastructure through its own pipeline._

## Components and Data Flow

| Component | Category | Description |
|---|---|---|
| Developer Loop | BUILD | Codex and Claude assisted implementation, local Vite/Node dev, build checks, repo updates. |
| GitHub Repository | SOURCE | React frontend, Express backend, shared AWS resource registry, docs, and workflow files. |
| GitHub Actions | CI/CD | Manual environment deploy, Node 20 build, tests when present, OIDC AWS credentials. |
| AWS Deploy Role | IAM | Repository secret points to role ARN. OIDC issues short-lived credentials. |
| CloudFront + S3 | FRONTEND | Vite build output is synced to S3 and CloudFront is invalidated for the public SPA. |
| API Gateway + Lambda | API | Express app is wrapped by serverless-http. Lambda connects MongoDB and reconciles interrupted deployments on cold start. |
| MongoDB Atlas | DATA | Users, workspaces, AWS accounts, diagrams, deployments, agent conversations, audit logs. |
| User Browser | — | Landing page, auth, dashboard, AWS insights, visual builder, pipelines, support, admin. |
| Connected AWS Account | — | Infraflow assumes the customer role for sync, validation, apply, destroy, and inventory. |
| GitHub Terraform Runner | — | Generated `main.tf` can be pushed to the repo and run via validate/deploy workflows. |

**Connections:**

- Developer Loop → GitHub Repository (`push`)
- GitHub Repository → GitHub Actions (`workflow_dispatch`)
- GitHub Actions → AWS Deploy Role (`assume role`)
- GitHub Actions → CloudFront + S3 (`static deploy`)
- AWS Deploy Role → API Gateway + Lambda (`backend target`)
- CloudFront + S3 → User Browser (`serve SPA`)
- User Browser → API Gateway + Lambda (`/api/v1`)
- API Gateway + Lambda → MongoDB Atlas (`mongoose`)
- API Gateway + Lambda → Connected AWS Account (`sts + AWS SDK`)
- Connected AWS Account → GitHub Terraform Runner (`dispatch`)
- GitHub Terraform Runner → API Gateway + Lambda (`callbacks`)

**The five-step deployment pipeline:**

1. **Design** — ReactFlow canvas
2. **Validate** — diagram + HCL + Terraform
3. **Plan** — cost/risk preview
4. **Apply** — AWS resources
5. **Observe** — logs + inventory

## Runtime Request Flow

_The deployed application separates the static SPA, serverless API, database state, and external cloud systems._

| Component | Description |
|---|---|
| Browser | Authenticated user interacts with dashboard, builder, AWS insights, and pipeline pages. |
| CloudFront CDN | Caches and serves the Vite React static build from S3. |
| S3 Static Site | Stores `dist/` assets created by `npm run build`. |
| React SPA | Routes: overview, visual builder, deployments, resource info, infra pipeline, app pipeline, AI agent. |
| API Gateway | Receives `/api/v1` requests and forwards them to the serverless Express handler. |
| Lambda Express API | Helmet, CORS, rate limit, auth middleware, route modules, error handling. |
| MongoDB | Workspace-scoped persistent state and deployment lifecycle logs. |
| Auth + RBAC | JWT access tokens, httpOnly refresh token, workspace roles, protected routes. |
| AWS Sync | STS, Cost Explorer, EC2, Lambda, S3, RDS, CloudWatch, CloudTrail, IAM. |
| Terraform Engine | Generator, validation gate, local or GitHub runner, logs, status updates. |
| App Pipeline | Generates GitHub Actions workflow, Dockerfile, deploy manifest, and OIDC deploy role. |

**Connections:**

- Browser → CloudFront CDN (`HTTPS`)
- CloudFront CDN → S3 Static Site (`origin`)
- S3 Static Site → React SPA (`assets`)
- React SPA → API Gateway (`/api/v1`)
- API Gateway → Lambda Express API (`proxy`)
- Lambda Express API → MongoDB (`read/write`)
- Lambda Express API → Auth + RBAC (`auth`)
- Lambda Express API → AWS Sync (`assume role`)
- Lambda Express API → Terraform Engine (`deploy`)
- Lambda Express API → App Pipeline (`generate CI/CD`)

**Route surface:** `/auth` `/dashboard` `/diagrams` `/deployments` `/aws` `/agent` `/app-pipelines` `/github` `/notifications` `/tickets`

> Route surface extracted from `IAAS backend/src/routes/index.js`.

## Infrastructure Deployment Flow

_The visual builder turns a diagram into Terraform, then applies it only after repeated gates pass._

1. **Canvas** — ReactFlow nodes and edges. Connections become Terraform references, not just visual links.
2. **Client Check** — Missing fields, invalid ARNs, dangling edges, and risky security group rules surface early.
3. **Backend Plan** — Server validates again, generates HCL, checks structure, and creates a Deployment record.
4. **Terraform Validate** — Local Terraform CLI or GitHub Actions validates generated `main.tf` against provider schemas.
5. **Plan + Apply** — Terraform init, plan, apply or destroy run with short-lived AWS session credentials.
6. **Observe** — Logs, status, outputs, resource inventory, drift checks, and safe teardown flow back to dashboard.

**Deployment safety gates:**

- Workspace isolation
- Diagram validation
- Generated HCL check
- `terraform validate`
- `terraform plan`
- Auto cleanup on failed first apply

> Executor options include local backend runner and GitHub-hosted Terraform workflows. Sensitive outputs can be moved behind Secrets Manager references.

## Self-Pipeline and Ownership Model

_How Infraflow deploys itself and how it provisions infrastructure for users without storing AWS keys._

### Codex / Claude Assisted Changes

- **Local Build** — `npm run build` and backend checks.
- **Repo Changes** — React, Express, docs, workflows.

Local Build → Repo Changes

### GitHub Source + Actions

- **Workflow Dispatch** — environment selected manually.
- **Build + Scan** — Node 20, `npm ci`, optional tests, Vite build.
- **OIDC Login** — Assume AWS deploy role.

Workflow Dispatch → Build + Scan → OIDC Login

### Infraflow Hosted Runtime

- **Static Frontend** — S3 sync and CloudFront invalidate.
- **Serverless API** — Express Lambda behind API Gateway.
- **State Services** — MongoDB and secrets broker.

OIDC Login → Static Frontend (`deploy assets`) · OIDC Login → Serverless API (`backend target`, dashed/not-yet-verified path) · Serverless API → Generated Terraform (`deploy request`)

### Customer Cloud Runtime

- **AWS Role Setup** — Trust policy and permissions policy shown to users with masked ARN.
- **Generated Terraform** — Resource graph produces `main.tf`.
- **GitHub Terraform Jobs** — Validate, plan, apply, destroy, callback.

AWS Role Setup → Generated Terraform → GitHub Terraform Jobs → State Services (`status callback`)

> [!IMPORTANT]
> **Important current-state note**
> The repository includes Lambda entrypoint code and docs describing API Gateway + Lambda hosting. The inspected development deploy workflow clearly deploys the static frontend to S3/CloudFront and prepares AWS OIDC credentials; backend Lambda update should be verified before production release if not already handled elsewhere.

---

_Sources reviewed: README.md, docs/HLD.md, .github/workflows/infraflow-development-deploy.yml, .github/workflows/terraform-validate.yml ..._
