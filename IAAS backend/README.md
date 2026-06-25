# infraflow backend

Node.js backend for the infraflow visual AWS infrastructure automation app.

## Features

- JWT authentication with register/login/refresh/logout/me.
- Role based access control: `owner`, `admin`, `architect`, `devops`, `viewer`.
- First registered user automatically becomes `owner`.
- Workspace-aware data model.
- Diagram CRUD for React Flow nodes/edges/config.
- Diagram validation and Terraform generation.
- Deployment plan creation from a drawn diagram.
- AWS account connection model using role ARN, not static AWS keys.
- Live AWS insights API with dummy data ready to replace with AWS SDK calls.
- AI Cloud Agent conversation API with contextual responses.
- Security findings, cost recommendations, inventory, billing, and dashboard APIs.

## Setup

1. Copy `.env.example` to `.env`.
2. Put your MongoDB URI into `MONGODB_URI`.
3. Install dependencies:

```bash
npm install
```

4. Start the API:

```bash
npm run dev
```

The API runs on `http://localhost:4000/api/v1` by default.
Health checks: `GET http://localhost:4000/health` or `GET http://localhost:4000/api/v1/health`.

## AWS Deployment Role

The connected AWS role must allow both resource creation and Terraform read-back actions. For EC2 deployments, include `ec2:RunInstances`, `ec2:CreateTags`, `ec2:DescribeInstances`, `ec2:DescribeInstanceAttribute`, `ec2:DescribeVpcs`, and `ec2:DescribeVpcAttribute`; otherwise Terraform can plan or create resources but fail while reading default VPC and EC2 state. If Terraform creates security groups, also include `ec2:CreateSecurityGroup`, `ec2:AuthorizeSecurityGroupIngress`, `ec2:AuthorizeSecurityGroupEgress`, `ec2:RevokeSecurityGroupIngress`, `ec2:RevokeSecurityGroupEgress`, and `ec2:DeleteSecurityGroup`. If the EC2 node uses an IAM role, also include `iam:GetRole`, `iam:PassRole`, `iam:CreateInstanceProfile`, `iam:AddRoleToInstanceProfile`, `iam:RemoveRoleFromInstanceProfile`, and `iam:DeleteInstanceProfile`.

## Important API Routes

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/health`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/users`
- `PATCH /api/v1/users/:id/role`
- `PATCH /api/v1/users/:id/status`
- `GET /api/v1/diagrams`
- `POST /api/v1/diagrams`
- `POST /api/v1/diagrams/:id/validate`
- `GET /api/v1/diagrams/:id/terraform`
- `POST /api/v1/deployments/from-diagram/:diagramId`
- `GET /api/v1/aws/insights`
- `POST /api/v1/aws/accounts`
- `POST /api/v1/agent/conversations`
- `POST /api/v1/agent/conversations/:id/messages`
