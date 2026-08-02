import { connectDatabase } from './IAAS backend/src/config/database.js';
import { ApplicationPipeline } from './IAAS backend/src/models/ApplicationPipeline.js';

await connectDatabase();
const pipelines = await ApplicationPipeline.find({}).select('name environment repository generatedFiles.path createdAt updatedAt').lean();
for (const p of pipelines) {
  console.log('====', p.name, '====');
  console.log('  id:', p._id.toString());
  console.log('  environment:', p.environment);
  console.log('  repository.workflowPath:', p.repository?.workflowPath);
  console.log('  repository.url:', p.repository?.url);
  console.log('  generatedFiles paths:', (p.generatedFiles || []).map(f => f.path));
  console.log('  updatedAt:', p.updatedAt);
}
process.exit(0);
