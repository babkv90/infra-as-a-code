import {
  CreateOpenIDConnectProviderCommand,
  CreateRoleCommand,
  GetOpenIDConnectProviderCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
  UpdateAssumeRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { GetBucketEncryptionCommand, S3Client } from '@aws-sdk/client-s3';
import { assumeAwsRole } from './awsRoleCredentials.js';

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_HOSTNAME = 'token.actions.githubusercontent.com';
// AWS no longer verifies this against the live cert for trusted OIDC issuers like GitHub,
// but the API still requires a syntactically valid (40 hex char) thumbprint.
const GITHUB_OIDC_THUMBPRINTS = ['ab9d0263244dd0326eb67015705a667e79cfe998', '1c58a3a8518e8759bf075b76b750d4f2df264fcd'];

export function buildOidcTrustPolicy({ owner, repo, branch, accountId }) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: `arn:aws:iam::${accountId}:oidc-provider/${GITHUB_OIDC_HOSTNAME}` },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
          StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${owner}/${repo}:ref:refs/heads/${branch}` },
        },
      },
    ],
  };
}

export function buildOidcPermissionsPolicy({ target, accountId, kmsKeyArn }) {
  const statements = [];

  if (target.type === 's3-cloudfront') {
    statements.push({
      Sid: 'DeployToS3',
      Effect: 'Allow',
      Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:ListBucket'],
      Resource: [`arn:aws:s3:::${target.bucketName}`, `arn:aws:s3:::${target.bucketName}/*`],
    });
    statements.push({
      Sid: 'InvalidateCloudFront',
      Effect: 'Allow',
      Action: ['cloudfront:CreateInvalidation'],
      Resource: '*',
    });
    if (kmsKeyArn) {
      // Required whenever the bucket has SSE-KMS default encryption — without this,
      // every PutObject fails with "not authorized to perform: kms:GenerateDataKey".
      statements.push({
        Sid: 'UseS3KmsKey',
        Effect: 'Allow',
        Action: ['kms:GenerateDataKey', 'kms:Decrypt', 'kms:DescribeKey'],
        Resource: kmsKeyArn,
      });
    }
  } else if (target.type === 'lambda') {
    statements.push({
      Sid: 'DeployLambda',
      Effect: 'Allow',
      Action: ['lambda:UpdateFunctionCode', 'lambda:GetFunction'],
      Resource: `arn:aws:lambda:${target.region}:${accountId}:function:${target.lambdaFunctionName}`,
    });
  } else {
    statements.push({
      Sid: 'PushToEcr',
      Effect: 'Allow',
      Action: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:PutImage',
        'ecr:BatchGetImage',
      ],
      Resource: '*',
    });
    statements.push(
      target.type === 'eks'
        ? { Sid: 'DescribeEksCluster', Effect: 'Allow', Action: ['eks:DescribeCluster'], Resource: '*' }
        : { Sid: 'UpdateEcsService', Effect: 'Allow', Action: ['ecs:UpdateService', 'ecs:DescribeServices'], Resource: '*' },
    );
  }

  return { Version: '2012-10-17', Statement: statements };
}

export function safeRoleName(value) {
  const cleaned = String(value || 'infraflow-deploy-role')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  return (cleaned || 'infraflow-deploy-role').slice(0, 64);
}

async function ensureOidcProvider(iam, accountId) {
  const arn = `arn:aws:iam::${accountId}:oidc-provider/${GITHUB_OIDC_HOSTNAME}`;
  try {
    await iam.send(new GetOpenIDConnectProviderCommand({ OpenIDConnectProviderArn: arn }));
    return arn;
  } catch (error) {
    if (error?.name !== 'NoSuchEntityException') throw error;
  }

  const created = await iam.send(
    new CreateOpenIDConnectProviderCommand({
      Url: GITHUB_OIDC_URL,
      ClientIDList: ['sts.amazonaws.com'],
      ThumbprintList: GITHUB_OIDC_THUMBPRINTS,
    }),
  );
  return created.OpenIDConnectProviderArn ?? arn;
}

async function roleExists(iam, roleName) {
  try {
    await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return true;
  } catch (error) {
    if (error?.name === 'NoSuchEntityException') return false;
    throw error;
  }
}

async function resolveBucketKmsKeyArn(s3, bucketName) {
  try {
    const result = await s3.send(new GetBucketEncryptionCommand({ Bucket: bucketName }));
    const rule = result.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
    if (rule?.SSEAlgorithm === 'aws:kms' && rule.KMSMasterKeyID) {
      return rule.KMSMasterKeyID;
    }
    return null;
  } catch (error) {
    if (error?.name === 'ServerSideEncryptionConfigurationNotFoundError') return null;
    throw error;
  }
}

export async function provisionOidcDeployRole({ account, pipelineId, pipelineName, owner, repo, branch, target }) {
  if (!account?.accountId) throw new Error('AWS account is missing its AWS account ID.');
  if (!owner || !repo) throw new Error('GitHub owner and repository are required to scope the deploy role.');

  const credentials = await assumeAwsRole(account);
  const region = account.defaultRegion || 'us-east-1';
  const iam = new IAMClient({ region, credentials });
  const accountId = account.accountId;

  const kmsKeyArn =
    target.type === 's3-cloudfront' && target.bucketName
      ? await resolveBucketKmsKeyArn(new S3Client({ region, credentials }), target.bucketName)
      : null;

  await ensureOidcProvider(iam, accountId);

  const roleName = safeRoleName(`infraflow-${pipelineName}-${String(pipelineId).slice(-8)}`);
  const trustPolicy = buildOidcTrustPolicy({ owner, repo, branch, accountId });
  const permissionsPolicy = buildOidcPermissionsPolicy({ target, accountId, kmsKeyArn });

  if (await roleExists(iam, roleName)) {
    await iam.send(new UpdateAssumeRolePolicyCommand({ RoleName: roleName, PolicyDocument: JSON.stringify(trustPolicy) }));
  } else {
    await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: `Infraflow-managed GitHub Actions OIDC deploy role for ${owner}/${repo}@${branch}.`,
        MaxSessionDuration: 3600,
      }),
    );
  }

  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: `${roleName}-permissions`,
      PolicyDocument: JSON.stringify(permissionsPolicy),
    }),
  );

  return { roleArn: `arn:aws:iam::${accountId}:role/${roleName}`, roleName, accountId };
}
