# nodeApplicationDep deployment pipeline

This pipeline deploys from a selected GitHub Environment. It authenticates to AWS using
GitHub's OIDC provider; no long-lived AWS deploy keys are stored in GitHub.

## Automatic setup

If this pipeline is linked to an infraflow deployment with a connected AWS account,
Infraflow automatically provisions the OIDC provider, the IAM deploy role scoped to
this repo plus selected branch/environment subjects, and the `AWS_DEPLOY_ROLE_ARN`
secret for you. Check the pipeline's "AWS deploy role" status in the dashboard. If it
says "Provisioned", you can deploy. Manual setup is only needed if the status says
"Skipped" or "Failed".

## Why "Configure AWS credentials with OIDC" fails

That step calls `sts:AssumeRoleWithWebIdentity` using a token GitHub issues for the run.
It fails when any of these are missing or mismatched:

1. The AWS account has no OIDC identity provider for `token.actions.githubusercontent.com`.
2. The IAM role trust policy does not match this repo. With GitHub Environments, the
   run subject is `repo:babkv90/infra-as-a-code:environment:<environment>`, not only
   `repo:babkv90/infra-as-a-code:ref:refs/heads/main`.
3. GitHub has no `AWS_DEPLOY_ROLE_ARN` repository secret or selected Environment secret, or it points
   to a role in the wrong AWS account.
4. The workflow's `permissions.id-token: write` block was removed.

## One-time AWS setup

Run these once per AWS account. Replace `<ACCOUNT_ID>` with your account ID first.

```bash
# 1. Create the OIDC provider. Skip if it already exists.
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea 1c58a3a8518e8759bf075b76b750d4f2df264fcd

# 2. Create the deploy role trusted for this repo + selected environments.
aws iam create-role \
  --role-name nodeapplicationdep-deploy-role \
  --assume-role-policy-document file://deploy/oidc-trust-policy.json

# 3. Attach the least-privilege permissions this pipeline needs.
aws iam put-role-policy \
  --role-name nodeapplicationdep-deploy-role \
  --policy-name nodeapplicationdep-deploy-role-permissions \
  --policy-document file://deploy/oidc-permissions-policy.json
```

If the role already exists, update its trust policy instead:

```bash
aws iam update-assume-role-policy \
  --role-name nodeapplicationdep-deploy-role \
  --policy-document file://deploy/oidc-trust-policy.json
```

## Required GitHub secret

- `AWS_DEPLOY_ROLE_ARN`: set this as a repository secret or per-environment secret:
  `arn:aws:iam::<ACCOUNT_ID>:role/nodeapplicationdep-deploy-role`

Recommended secrets by target:
- `INFRAFLOW_APP_AWS_ACCESS_KEY_ID` and `INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY` for Lambda backend apps that need to connect AWS accounts.
- `INFRAFLOW_APP_AWS_SESSION_TOKEN` only when the access key is temporary.

## Target

- Type: lambda
- Region: ap-south-1
- ECR repository: api-gateway-lambda-iam-role-app
- Service: serverless-api-service
