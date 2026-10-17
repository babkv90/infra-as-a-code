// Builds the Lambda deployment package in .lambda-build/ (zipped as-is by the deploy workflow).
//
// Why a bundle instead of zipping this folder: the backend imports the frontend's own TypeScript
// (../../../src/utils/*.ts, src/data/awsServices.ts — "same functions the browser calls"), which
// only works locally because `npm start` runs under the tsx loader. A plain zip of this folder has
// neither tsx registered nor the frontend src/ in it, and its node_modules alone exceed Lambda's
// 70 MB direct-upload limit. esbuild compiles all of it — backend, frontend .ts, JSON — into one
// file, so the Lambda needs no loader and only the few packages that can't be bundled.
//
// Layout (mirrors the source tree so every `import.meta.url`-relative path still resolves):
//   lambda.js               re-exports the handler — the function's `lambda.handler` is unchanged
//   src/bundle/lambda.mjs   the bundle; `../../shared`, `../../uploads`, `../..` (reference PDFs)
//                           resolve exactly as they did from src/<dir>/<file>.js
//   shared/, *.pdf          runtime files read from disk
//   node_modules/           only EXTERNAL_PACKAGES and their dependencies
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(backendRoot, '.lambda-build');
const bundleFile = path.join(outDir, 'src', 'bundle', 'lambda.mjs');

// Loaded from node_modules at runtime instead of bundled: pdf-parse pulls in pdfjs-dist, which
// loads its worker and optional native canvas by path at runtime — that breaks inside a bundle.
const EXTERNAL_PACKAGES = ['pdf-parse'];
// Optional peers mongodb/mongoose try to require() and gracefully skip when absent.
const OPTIONAL_PEERS = [
  'kerberos',
  '@mongodb-js/zstd',
  'snappy',
  'socks',
  'aws4',
  'mongodb-client-encryption',
  'gcp-metadata',
  '@aws-sdk/credential-providers',
];

// CommonJS dependencies inside an ESM bundle still expect require/__dirname/__filename. `require`
// is provided as a real binding; the two path globals go through `define` to distinct names so
// they can't collide with the backend's own top-level `const __dirname = ...` declarations.
const banner = [
  "import { createRequire as __bundleCreateRequire } from 'node:module';",
  "import { fileURLToPath as __bundleFileUrlToPath } from 'node:url';",
  "import { dirname as __bundlePathDirname } from 'node:path';",
  'const require = __bundleCreateRequire(import.meta.url);',
  'const __bundleFilename = __bundleFileUrlToPath(import.meta.url);',
  'const __bundleDirname = __bundlePathDirname(__bundleFilename);',
].join('\n');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.dirname(bundleFile), { recursive: true });

const result = await build({
  entryPoints: [path.join(backendRoot, 'src', 'lambda.js')],
  outfile: bundleFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  minify: true,
  sourcemap: 'linked',
  legalComments: 'none',
  external: [...EXTERNAL_PACKAGES, ...OPTIONAL_PEERS],
  define: { __dirname: '__bundleDirname', __filename: '__bundleFilename' },
  banner: { js: banner },
  logLevel: 'warning',
  metafile: true,
});

// The entrypoint loads the bundle itself, so a failure while loading it (a missing native binary,
// an unsupported Node version) becomes a logged, explained 500 instead of an opaque Lambda init
// crash that API Gateway reports only as "Internal Server Error".
writeFileSync(
  path.join(outDir, 'lambda.js'),
  `let app;
let startupError;
try {
  app = await import('./src/bundle/lambda.mjs');
} catch (error) {
  startupError = error;
  console.error('Backend failed to start', error);
}

export const handler = async (event, context) => {
  if (app) return app.handler(event, context);
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      message: 'Backend failed to start',
      startupError: \`\${startupError?.code ?? startupError?.name ?? 'Error'}: \${String(startupError?.message ?? startupError).split('\\n')[0].slice(0, 300)}\`,
      node: process.version,
      arch: process.arch,
    }),
  };
};
`,
);

// Runtime files the code reads relative to its own location.
const sharedSource = [path.join(backendRoot, 'shared'), path.join(backendRoot, '..', 'shared')].find((dir) => existsSync(path.join(dir, 'resourceRegistry.json')));
if (!sharedSource) throw new Error('shared/resourceRegistry.json not found next to or above the backend.');
cpSync(sharedSource, path.join(outDir, 'shared'), { recursive: true });
for (const file of readdirSync(backendRoot)) {
  if (file.endsWith('.pdf')) cpSync(path.join(backendRoot, file), path.join(outDir, file));
}

// Install only the external packages, at the exact versions this backend was tested with.
const installed = Object.fromEntries(
  EXTERNAL_PACKAGES.map((name) => [name, JSON.parse(readFileSync(path.join(backendRoot, 'node_modules', name, 'package.json'), 'utf8')).version]),
);
writeFileSync(
  path.join(outDir, 'package.json'),
  `${JSON.stringify({ name: 'infraflow-backend-lambda', private: true, type: 'module', dependencies: installed }, null, 2)}\n`,
);
execFileSync('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], {
  cwd: outDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const bundleBytes = statSync(bundleFile).size;
const inputs = Object.keys(result.metafile.inputs).filter((input) => input.includes('src/') && input.endsWith('.ts')).length;
console.log(`Lambda package ready in ${path.relative(backendRoot, outDir)}: bundle ${(bundleBytes / 1024 / 1024).toFixed(1)} MB, ${inputs} frontend .ts modules compiled in, externals: ${EXTERNAL_PACKAGES.join(', ')}`);
