import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { assumeAwsRole } from './awsRoleCredentials.js';

async function listAllLambdaFunctionNames(lambda) {
  let marker;
  const names = [];

  do {
    const page = await lambda.send(new ListFunctionsCommand({ Marker: marker }));
    names.push(...(page.Functions ?? []).map((item) => item.FunctionName).filter(Boolean));
    marker = page.NextMarker;
  } while (marker);

  return names;
}

function timeLabel(date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function bucketKey(date) {
  return new Date(date).toISOString().slice(0, 16);
}

export async function getRealtimeLambdaMetrics(account, options = {}) {
  const region = account.defaultRegion || process.env.AWS_REGION || 'ap-south-1';
  const credentials = await assumeAwsRole(account);
  const windowMinutes = Number(options.windowMinutes ?? 30);
  const periodSeconds = Number(options.periodSeconds ?? 300);
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowMinutes * 60 * 1000);
  const lambda = new LambdaClient({ region, credentials });
  const cloudwatch = new CloudWatchClient({ region, credentials });
  const functionNames = (await listAllLambdaFunctionNames(lambda)).slice(0, 100);

  if (!functionNames.length) {
    return {
      region,
      updatedAt: endTime.toISOString(),
      windowMinutes,
      periodSeconds,
      functionCount: 0,
      totalInvocations: 0,
      totalErrors: 0,
      points: [],
    };
  }

  const metricDataQueries = functionNames.flatMap((functionName, index) => [
    {
      Id: `inv${index}`,
      Label: `${functionName} invocations`,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/Lambda',
          MetricName: 'Invocations',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: `err${index}`,
      Label: `${functionName} errors`,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/Lambda',
          MetricName: 'Errors',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
  ]);

  const response = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      MetricDataQueries: metricDataQueries,
      ScanBy: 'TimestampAscending',
    }),
  );

  const pointsByBucket = new Map();

  for (const result of response.MetricDataResults ?? []) {
    const isErrorMetric = result.Id?.startsWith('err');
    (result.Timestamps ?? []).forEach((timestamp, index) => {
      const key = bucketKey(timestamp);
      const existing = pointsByBucket.get(key) ?? {
        at: new Date(timestamp).toISOString(),
        label: timeLabel(timestamp),
        invocations: 0,
        errors: 0,
      };
      const value = Number(result.Values?.[index] ?? 0);
      if (isErrorMetric) {
        existing.errors += value;
      } else {
        existing.invocations += value;
      }
      pointsByBucket.set(key, existing);
    });
  }

  const points = [...pointsByBucket.values()]
    .map((point) => ({
      ...point,
      invocations: Math.round(point.invocations),
      errors: Math.round(point.errors),
    }))
    .sort((left, right) => left.at.localeCompare(right.at));

  return {
    region,
    updatedAt: endTime.toISOString(),
    windowMinutes,
    periodSeconds,
    functionCount: functionNames.length,
    totalInvocations: points.reduce((sum, point) => sum + point.invocations, 0),
    totalErrors: points.reduce((sum, point) => sum + point.errors, 0),
    points,
  };
}
