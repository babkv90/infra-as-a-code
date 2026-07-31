# ReactPipeline deployment pipeline

This pipeline deploys from a selected GitHub Environment. It authenticates to AWS using
GitHub's OIDC provider — no long-lived AWS deploy keys are stored in GitHub.

## Automatic setup

If this pipeline is linked to an infraflow deployment with a connected AWS account,
Infraflow automatically provisions the OIDC provider, the IAM deploy role (scoped to
this exact repo plus branch/environment subjects), and the `AWS_DEPLOY_ROLE_ARN` GitHub secret for you the
moment you sync this pipeline to GitHub. Check the pipeline's "AWS deploy role" status
in the dashboard — if it says "Provisioned", skip straight to pushing your code. The
manual steps below are only needed if that status says "Skipped" (no AWS account
linked) or "Failed" (check the error shown in the dashboard).

## Why "Configure AWS credentials with OIDC" fails

That step calls `sts:AssumeRoleWithWebIdentity` using a token GitHub issues for the run.
It fails when any of these are missing or mismatched:

1. The AWS account has no OIDC identity provider for `token.actions.githubusercontent.com`.
2. The IAM role trust policy does not match this repo. With GitHub Environments, the
   run subject is `repo:babkv90/infra-as-a-code:environment:<environment>`, not only
   `repo:babkv90/infra-as-a-code:ref:refs/heads/main`.
3. GitHub has no `AWS_DEPLOY_ROLE_ARN` repository secret or selected Environment secret, or it points at a role
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

# 2. Create the deploy role, trusted only for this repo + selected environments (see deploy/oidc-trust-policy.json)
aws iam create-role \
  --role-name reactpipeline-deploy-role \
  --assume-role-policy-document file://deploy/oidc-trust-policy.json

# 3. Attach the least-privilege permissions this pipeline needs (see deploy/oidc-permissions-policy.json)
aws iam put-role-policy \
  --role-name reactpipeline-deploy-role \
  --policy-name reactpipeline-deploy-role-permissions \
  --policy-document file://deploy/oidc-permissions-policy.json
```

Before running step 2, replace `<ACCOUNT_ID>` in `deploy/oidc-trust-policy.json` with your
AWS account ID. Before running step 3, replace `<ACCOUNT_ID>` in
`deploy/oidc-permissions-policy.json` if it references account-scoped ARNs (Lambda target only).

## Required GitHub secret

- `AWS_DEPLOY_ROLE_ARN`: set this as a repository secret or per-environment secret. Use the ARN printed by step 2 above, e.g.
  `arn:aws:iam::<ACCOUNT_ID>:role/reactpipeline-deploy-role`.

Recommended secrets by target:
- Environment variable `VITE_API_BASE_URL` for S3 and CloudFront apps. `INFRAFLOW_API_BASE_URL` is accepted as a fallback alias.
- Environment variable `CLOUDFRONT_DISTRIBUTION_ID` for S3 and CloudFront apps (leave unset to skip cache invalidation).
- Environment secrets `INFRAFLOW_APP_AWS_ACCESS_KEY_ID` and `INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY` for Lambda backend apps that need to connect AWS accounts from production.
- Environment secret `INFRAFLOW_APP_AWS_SESSION_TOKEN` only when the access key is temporary.
- Environment secrets `INFRAFLOW_GITHUB_CLIENT_ID` and `INFRAFLOW_GITHUB_CLIENT_SECRET` for GitHub OAuth repository connections.
- Environment variable or secret `INFRAFLOW_GITHUB_OAUTH_CALLBACK_URL` set to the backend callback URL registered in the GitHub OAuth app, e.g. `https://<api-host>/api/v1/github/oauth/callback`.

## Target

- Type: s3-cloudfront
- Region: ap-south-1
- ECR repository: react-vue-angular-static-frontend-app
- Service: react-app-service
