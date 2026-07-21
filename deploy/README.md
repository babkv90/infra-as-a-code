# Production application pipelinera3w deployment pipeline

This pipeline deploys on every push to `main`. It authenticates to AWS using
GitHub's OIDC provider — no long-lived AWS access keys are stored in GitHub.

## Automatic setup

If this pipeline is linked to an infraflow deployment with a connected AWS account,
Infraflow automatically provisions the OIDC provider, the IAM deploy role (scoped to
this exact repo/branch), and the `AWS_DEPLOY_ROLE_ARN` GitHub secret for you the
moment you sync this pipeline to GitHub. Check the pipeline's "AWS deploy role" status
in the dashboard — if it says "Provisioned", skip straight to pushing your code. The
manual steps below are only needed if that status says "Skipped" (no AWS account
linked) or "Failed" (check the error shown in the dashboard).

## Why "Configure AWS credentials with OIDC" fails

That step calls `sts:AssumeRoleWithWebIdentity` using a token GitHub issues for the run.
It fails when any of these are missing, and AWS gives no hint which one:

1. The AWS account has no OIDC identity provider for `token.actions.githubusercontent.com`.
2. The IAM role's trust policy doesn't exist, or its `sub` condition doesn't match
   `repo:babkv90/infra-as-a-code:ref:refs/heads/main` exactly (wrong owner/repo, wrong branch,
   or a typo).
3. The `AWS_DEPLOY_ROLE_ARN` repository secret is missing, empty, or points at a role
   in the wrong AWS account.
4. The workflow's `permissions.id-token: write` block was removed (already included here).

## One-time AWS setup

Run these once per AWS account (replace `<ACCOUNT_ID>` with your account ID):

```bash
# 1. Create the OIDC provider (skip if it already exists — one per AWS account, shared by all repos)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea 1c58a3a8518e8759bf075b76b750d4f2df264fcd

# 2. Create the deploy role, trusted only for this repo + branch (see deploy/oidc-trust-policy.json)
aws iam create-role \
  --role-name production-application-pipelinera3w-deploy-role \
  --assume-role-policy-document file://deploy/oidc-trust-policy.json

# 3. Attach the least-privilege permissions this pipeline needs (see deploy/oidc-permissions-policy.json)
aws iam put-role-policy \
  --role-name production-application-pipelinera3w-deploy-role \
  --policy-name production-application-pipelinera3w-deploy-role-permissions \
  --policy-document file://deploy/oidc-permissions-policy.json
```

Before running step 2, replace `<ACCOUNT_ID>` in `deploy/oidc-trust-policy.json` with your
AWS account ID. Before running step 3, replace `<ACCOUNT_ID>` in
`deploy/oidc-permissions-policy.json` if it references account-scoped ARNs (Lambda target only).

## Required GitHub repository secret

- `AWS_DEPLOY_ROLE_ARN`: the ARN printed by step 2 above, e.g.
  `arn:aws:iam::<ACCOUNT_ID>:role/production-application-pipelinera3w-deploy-role`.

Recommended secrets by target:
- `CLOUDFRONT_DISTRIBUTION_ID` for S3 and CloudFront apps (leave unset to skip cache invalidation).

## Target

- Type: s3-cloudfront
- Region: ap-south-1
- ECR repository: current-visual-infrastructure-deployment-app
- Service: react-app-service
