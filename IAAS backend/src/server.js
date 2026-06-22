import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { app } from './app.js';

async function startServer() {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`IAAS backend running on port ${env.PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start IAAS backend', error);
  process.exit(1);
});
