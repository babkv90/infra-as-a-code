// Generates the Python agent service's closed-vocabulary schema from the single source of truth,
// src/data/awsServices.ts — run as a `prebuild` step so the two can never drift. See
// services/agents/app/tools/schemas/aws_services.json (git-tracked, generated — do not hand-edit).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { awsServices } from '../src/data/awsServices';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../services/agents/app/tools/schemas/aws_services.json');

const services = Object.fromEntries(
  awsServices.map((service) => [
    service.id,
    {
      terraformType: service.terraformType,
      required: service.fields.filter((field) => field.required).map((field) => field.key),
      fields: Object.fromEntries(
        service.fields.map((field) => [
          field.key,
          { type: field.type, ...(field.options ? { options: field.options } : {}) },
        ]),
      ),
    },
  ]),
);

const schema = {
  serviceIds: awsServices.map((service) => service.id),
  services,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');

console.log(`Wrote ${awsServices.length} service schemas to ${outPath}`);
