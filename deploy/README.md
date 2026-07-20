# Production application pipeline deployment pipeline

This pipeline deploys on every push to the configured branch.

Required GitHub repository secret:
- AWS_DEPLOY_ROLE_ARN: IAM role trusted by GitHub OIDC for this repository.

Recommended secrets by target:
- CLOUDFRONT_DISTRIBUTION_ID for S3 and CloudFront apps.

Target:
- Type: s3-cloudfront
- Region: ap-south-1
- ECR repository: current-visual-infrastructure-deployment-app
- Service: static-frontend-edge-waf
