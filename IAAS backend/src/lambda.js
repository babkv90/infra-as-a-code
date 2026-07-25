import serverless from 'serverless-http';
import { app } from './app.js';
import { connectDatabase } from './config/database.js';

// connectDatabase() caches its connection (see config/database.js), so calling it on every
// invocation is cheap once a warm Lambda container already has one open.
const serverlessHandler = serverless(app);

export const handler = async (event, context) => {
  // Let the process return as soon as the response is sent instead of waiting for Node's event
  // loop to drain — mongoose keeps the MongoDB socket open across invocations on purpose so a warm
  // container can reuse it, which would otherwise stall every response until Lambda's timeout.
  context.callbackWaitsForEmptyEventLoop = false;
  await connectDatabase();
  return serverlessHandler(event, context);
};
