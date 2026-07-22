// Reference IAM policy for the role infraflow assumes to deploy infrastructure into a connected
// AWS account. Covers every resource type the diagram builder can generate (S3, EC2/VPC networking,
// Lambda, ECS/ECR, RDS/DocumentDB, ALB/API Gateway, CloudFront, WAF, CloudWatch, queues/topics,
// EventBridge, Secrets Manager, KMS, Cognito, CodeBuild/CodePipeline, Beanstalk, Kinesis, EFS), the
// IAM role lifecycle infraflow manages on your behalf (scoped to role/infraflow-*, never your own
// roles), the GitHub Actions OIDC provider used by Application Pipelines, and the read-only account
// summary/billing calls used by the dashboard's live insights. Attaching this once avoids discovering
// missing permissions one deployment at a time.
export const deployRolePermissionsPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'CoreResourceProvisioning',
      Effect: 'Allow',
      Action: [
        's3:*',
        'ec2:*',
        'elasticloadbalancing:*',
        'lambda:*',
        'ecs:*',
        'ecr:*',
        'eks:*',
        'rds:*',
        'dynamodb:*',
        'elasticache:*',
        'redshift:*',
        'sqs:*',
        'sns:*',
        'events:*',
        'apigateway:*',
        'cloudfront:*',
        'route53:*',
        'wafv2:*',
        'cloudwatch:*',
        'logs:*',
        'secretsmanager:*',
        'kms:*',
        'cognito-idp:*',
        'codebuild:*',
        'codepipeline:*',
        'xray:*',
        'elasticbeanstalk:*',
        'kinesis:*',
        'efs:*',
        'sts:GetCallerIdentity',
      ],
      Resource: '*',
    },
    {
      Sid: 'ListIamRolesForPicker',
      Effect: 'Allow',
      Action: ['iam:ListRoles'],
      Resource: '*',
    },
    {
      Sid: 'ManageInfraflowIamRoles',
      Effect: 'Allow',
      Action: [
        'iam:CreateRole',
        'iam:GetRole',
        'iam:DeleteRole',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:UpdateAssumeRolePolicy',
        'iam:PutRolePolicy',
        'iam:GetRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:ListRolePolicies',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:ListAttachedRolePolicies',
        'iam:PassRole',
      ],
      Resource: 'arn:aws:iam::*:role/infraflow-*',
    },
    {
      Sid: 'ManageGithubOidcProvider',
      Effect: 'Allow',
      Action: ['iam:GetOpenIDConnectProvider', 'iam:CreateOpenIDConnectProvider'],
      Resource: 'arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com',
    },
    {
      Sid: 'AccountLevelReadForDashboard',
      Effect: 'Allow',
      Action: ['iam:GetAccountSummary', 'ce:GetCostAndUsage', 'cloudtrail:LookupEvents'],
      Resource: '*',
    },
  ],
};

export function buildDeployRoleTrustPolicy(deployerArn: string, externalId?: string) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: deployerArn },
        Action: 'sts:AssumeRole',
        ...(externalId ? { Condition: { StringEquals: { 'sts:ExternalId': externalId } } } : {}),
      },
    ],
  };
}
