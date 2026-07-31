import serverless from 'serverless-http';
import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { corsHeaders } from './utils/cors.js';
import { reconcileInterruptedDeployments } from './services/deploymentReconciliation.js';

// connectDatabase() caches its connection (see config/database.js), so calling it on every
// invocation is cheap once a warm Lambda container already has one open.
const serverlessHandler = serverless(app);

// server.js calls this once at startup for the traditional long-running-process deployment target —
// Lambda has no equivalent "startup" event, only cold starts, so this runs it once per fresh
// container instead (module-scope state, not per-invocation) right after the first successful DB
// connection. Without this, a deployment interrupted by a Lambda timeout/crash mid-apply (see
// deploymentReconciliation.js's own comment for why that can't simply be resumed) would sit at
// 'deploying'/'destroying' forever — nothing in the Lambda entrypoint was ever reconciling it.
let hasReconciledThisContainer = false;

async function reconcileOnceThisContainer() {
  if (hasReconciledThisContainer) return;
  hasReconciledThisContainer = true;
  try {
    await reconcileInterruptedDeployments();
  } catch (error) {
    // Never let a reconciliation failure block real requests from being served.
    console.error('Deployment reconciliation failed on cold start', error);
  }
}

export const handler = async (event, context) => {
  // Let the process return as soon as the response is sent instead of waiting for Node's event
  // loop to drain — mongoose keeps the MongoDB socket open across invocations on purpose so a warm
  // container can reuse it, which would otherwise stall every response until Lambda's timeout.
  context.callbackWaitsForEmptyEventLoop = false;
  const origin = event.headers?.origin ?? event.headers?.Origin;

  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: '',
    };
  }

  try {
    await connectDatabase();
    await reconcileOnceThisContainer();
    const response = await serverlessHandler(event, context);
    return {
      ...response,
      headers: {
        ...corsHeaders(origin),
        ...(response.headers ?? {}),
      },
    };
  } catch (error) {
    console.error('Lambda request failed before Express handled it', error);
    return {
      statusCode: 500,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ success: false, message: 'Internal server error' }),
    };
  }
};
