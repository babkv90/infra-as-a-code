import { ApiGatewayV2Client, GetApisCommand } from '@aws-sdk/client-apigatewayv2';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { EKSClient, ListClustersCommand as ListEksClustersCommand } from '@aws-sdk/client-eks';
import { EventBridgeClient, ListRulesCommand } from '@aws-sdk/client-eventbridge';
import { IAMClient, GetAccountSummaryCommand } from '@aws-sdk/client-iam';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { SNSClient, ListTopicsCommand } from '@aws-sdk/client-sns';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function monthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function makeCredentials(stsCredentials) {
  return {
    accessKeyId: stsCredentials.AccessKeyId,
    secretAccessKey: stsCredentials.SecretAccessKey,
    sessionToken: stsCredentials.SessionToken,
  };
}

async function capture(label, errors, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    errors.push({ service: label, message: error.message, code: error.name });
    return fallback;
  }
}

async function assumeAwsRole(account) {
  const sts = new STSClient({ region: 'us-east-1' });
  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: account.roleArn,
      RoleSessionName: `infraflow-${Date.now()}`,
      ExternalId: account.externalId || undefined,
      DurationSeconds: 3600,
    }),
  );

  return makeCredentials(response.Credentials);
}

async function countAll(sendPage, getItems, getNextToken) {
  let token;
  let total = 0;
  do {
    const page = await sendPage(token);
    total += getItems(page).length;
    token = getNextToken(page);
  } while (token);
  return total;
}

export async function syncAwsAccountData(account) {
  const errors = [];
  const region = account.defaultRegion || 'us-east-1';
  const credentials = await assumeAwsRole(account);

  const sts = new STSClient({ region: 'us-east-1', credentials });
  const identity = await sts.send(new GetCallerIdentityCommand({}));

  const lambda = new LambdaClient({ region, credentials });
  const ec2 = new EC2Client({ region, credentials });
  const s3 = new S3Client({ region: 'us-east-1', credentials });
  const rds = new RDSClient({ region, credentials });
  const cloudwatch = new CloudWatchClient({ region, credentials });
  const logs = new CloudWatchLogsClient({ region, credentials });
  const costExplorer = new CostExplorerClient({ region: 'us-east-1', credentials });
  const iam = new IAMClient({ region: 'us-east-1', credentials });
  const dynamodb = new DynamoDBClient({ region, credentials });
  const sqs = new SQSClient({ region, credentials });
  const sns = new SNSClient({ region, credentials });
  const eventBridge = new EventBridgeClient({ region, credentials });
  const apiGateway = new ApiGatewayV2Client({ region, credentials });
  const ecs = new ECSClient({ region, credentials });
  const eks = new EKSClient({ region, credentials });
  const cloudTrail = new CloudTrailClient({ region, credentials });

  const lambdaFunctions = await capture(
    'Lambda',
    errors,
    () => countAll((Marker) => lambda.send(new ListFunctionsCommand({ Marker })), (page) => page.Functions ?? [], (page) => page.NextMarker),
    0,
  );

  const ec2Reservations = await capture(
    'EC2',
    errors,
    async () => {
      const response = await ec2.send(new DescribeInstancesCommand({}));
      return response.Reservations ?? [];
    },
    [],
  );
  const ec2Instances = ec2Reservations.flatMap((reservation) => reservation.Instances ?? []);
  const runningEc2Instances = ec2Instances.filter((instance) => instance.State?.Name === 'running').length;
  const stoppedEc2Instances = ec2Instances.filter((instance) => instance.State?.Name === 'stopped').length;

  const volumes = await capture('EBS', errors, async () => (await ec2.send(new DescribeVolumesCommand({}))).Volumes ?? [], []);
  const unattachedVolumes = volumes.filter((volume) => volume.State === 'available').length;

  const buckets = await capture('S3', errors, async () => (await s3.send(new ListBucketsCommand({}))).Buckets ?? [], []);
  const rdsInstances = await capture('RDS', errors, async () => (await rds.send(new DescribeDBInstancesCommand({}))).DBInstances ?? [], []);
  const alarms = await capture('CloudWatch', errors, async () => (await cloudwatch.send(new DescribeAlarmsCommand({}))).MetricAlarms ?? [], []);
  const logGroups = await capture('CloudWatch Logs', errors, async () => (await logs.send(new DescribeLogGroupsCommand({ limit: 50 }))).logGroups ?? [], []);
  const ddbTables = await capture('DynamoDB', errors, async () => (await dynamodb.send(new ListTablesCommand({ Limit: 100 }))).TableNames ?? [], []);
  const queues = await capture('SQS', errors, async () => (await sqs.send(new ListQueuesCommand({}))).QueueUrls ?? [], []);
  const topics = await capture('SNS', errors, async () => (await sns.send(new ListTopicsCommand({}))).Topics ?? [], []);
  const eventRules = await capture('EventBridge', errors, async () => (await eventBridge.send(new ListRulesCommand({ Limit: 100 }))).Rules ?? [], []);
  const apis = await capture('API Gateway', errors, async () => (await apiGateway.send(new GetApisCommand({ MaxResults: '100' }))).Items ?? [], []);
  const ecsClusters = await capture('ECS', errors, async () => (await ecs.send(new ListClustersCommand({}))).clusterArns ?? [], []);
  const eksClusters = await capture('EKS', errors, async () => (await eks.send(new ListEksClustersCommand({}))).clusters ?? [], []);
  const iamSummary = await capture('IAM', errors, async () => (await iam.send(new GetAccountSummaryCommand({}))).SummaryMap ?? {}, {});
  const recentEvents = await capture(
    'CloudTrail',
    errors,
    async () => {
      const response = await cloudTrail.send(new LookupEventsCommand({ MaxResults: 20 }));
      return (response.Events ?? []).map((event) => ({
        id: event.EventId,
        name: event.EventName,
        source: event.EventSource,
        username: event.Username,
        at: event.EventTime?.toISOString(),
        resources: (event.Resources ?? []).map((resource) => ({
          name: resource.ResourceName,
          type: resource.ResourceType,
        })),
      }));
    },
    [],
  );

  const { start, end } = monthRange();
  const cost = await capture(
    'Cost Explorer',
    errors,
    async () =>
      costExplorer.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        }),
      ),
    undefined,
  );

  const serviceCosts =
    cost?.ResultsByTime?.[0]?.Groups?.map((group) => ({
      service: group.Keys?.[0] ?? 'Unknown',
      cost: roundCurrency(group.Metrics?.UnblendedCost?.Amount),
    }))
      .filter((item) => item.cost > 0)
      .sort((a, b) => b.cost - a.cost) ?? [];
  const monthlySpend = roundCurrency(serviceCosts.reduce((sum, item) => sum + item.cost, 0));

  const estimatedSavings = 0;
  const securityWarnings = alarms.filter((alarm) => alarm.StateValue === 'ALARM').length;
  const idleResources = stoppedEc2Instances + unattachedVolumes;
  const failedInvocations = 0;

  return {
    identity: {
      accountId: identity.Account,
      arn: identity.Arn,
      userId: identity.UserId,
      region,
    },
    billing: {
      monthlySpend,
      estimatedSavings,
      trend: [0, 0, 0, 0, 0, 0, monthlySpend],
      byService: serviceCosts.slice(0, 10),
    },
    resources: {
      lambdaFunctions,
      ec2Instances: runningEc2Instances,
      stoppedEc2Instances,
      s3Buckets: buckets.length,
      rdsInstances: rdsInstances.length,
      dynamodbTables: ddbTables.length,
      sqsQueues: queues.length,
      snsTopics: topics.length,
      eventBridgeRules: eventRules.length,
      apiGatewayApis: apis.length,
      ecsClusters: ecsClusters.length,
      eksClusters: eksClusters.length,
      cloudWatchAlarms: alarms.length,
      cloudWatchLogGroups: logGroups.length,
      iamRoles: Number(iamSummary.Roles || 0),
      iamUsers: Number(iamSummary.Users || 0),
      idleResources,
      failedInvocations,
      securityWarnings,
    },
    recommendations: [],
    securityFindings: alarms
      .filter((alarm) => alarm.StateValue === 'ALARM')
      .slice(0, 20)
      .map((alarm) => ({ severity: 'medium', title: `CloudWatch alarm in ALARM state: ${alarm.AlarmName}`, resource: alarm.AlarmArn })),
    inventory: [
      { service: 'Lambda', count: lambdaFunctions, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('Lambda'))?.cost ?? 0 },
      { service: 'EC2', count: runningEc2Instances, health: stoppedEc2Instances ? `${stoppedEc2Instances} stopped` : 'synced', spend: serviceCosts.find((item) => item.service.includes('EC2'))?.cost ?? 0 },
      { service: 'S3', count: buckets.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('S3'))?.cost ?? 0 },
      { service: 'RDS', count: rdsInstances.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('RDS'))?.cost ?? 0 },
      { service: 'CloudWatch', count: alarms.length + logGroups.length, health: securityWarnings ? `${securityWarnings} alarms` : 'synced', spend: serviceCosts.find((item) => item.service.includes('CloudWatch'))?.cost ?? 0 },
      { service: 'DynamoDB', count: ddbTables.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('DynamoDB'))?.cost ?? 0 },
      { service: 'SQS', count: queues.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('SQS'))?.cost ?? 0 },
      { service: 'SNS', count: topics.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('SNS'))?.cost ?? 0 },
      { service: 'EventBridge', count: eventRules.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('EventBridge'))?.cost ?? 0 },
      { service: 'API Gateway', count: apis.length, health: 'synced', spend: serviceCosts.find((item) => item.service.includes('API Gateway'))?.cost ?? 0 },
    ],
    events: recentEvents,
    permissionErrors: errors,
    syncedAt: new Date().toISOString(),
  };
}
