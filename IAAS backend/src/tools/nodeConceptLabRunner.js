import cluster from 'node:cluster';
import os from 'node:os';
import { parentPort, workerData, Worker, isMainThread } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

function countPrimes(limit) {
  let count = 0;

  for (let value = 2; value <= limit; value += 1) {
    let isPrime = true;
    for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
      if (value % divisor === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) count += 1;
  }

  return count;
}

function timedPrimeTask(limit) {
  const startedAt = performance.now();
  const primes = countPrimes(limit);

  return {
    limit,
    primes,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

if (!isMainThread) {
  const result = timedPrimeTask(workerData.limit);
  parentPort.postMessage({
    role: 'worker-thread',
    threadId: workerData.threadId,
    pid: process.pid,
    ...result,
  });
}

if (cluster.isWorker && process.argv[2] === 'cluster') {
  process.on('message', (message) => {
    if (!message || message.type !== 'run-prime-task') return;

    const result = timedPrimeTask(message.limit);
    process.send?.({
      type: 'worker-result',
      workerId: cluster.worker?.id,
      pid: process.pid,
      ...result,
    });
  });
}

const mode = process.argv[2];
const taskSize = Number(process.argv[3] ?? 22_000);
const requestedWorkers = Number(process.argv[4] ?? 2);

async function runWorkerThreadDemo(limit) {
  const startedAt = performance.now();

  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        threadId: 1,
        limit,
      },
    });

    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker thread exited with code ${code}`));
    });
  });

  return {
    concept: 'worker_threads',
    summary: 'CPU-bound prime counting ran away from the request thread.',
    totalDurationMs: Math.round(performance.now() - startedAt),
    units: [result],
  };
}

function runChildProcessDemo(limit) {
  const startedAt = performance.now();
  const result = timedPrimeTask(limit);

  return {
    concept: 'child_process',
    summary: 'An isolated Node process performed work with its own PID and memory space.',
    totalDurationMs: Math.round(performance.now() - startedAt),
    units: [
      {
        role: 'child-process',
        pid: process.pid,
        ...result,
      },
    ],
  };
}

async function runClusterDemo(limit, workerCount) {
  const startedAt = performance.now();
  const workers = Math.max(1, Math.min(workerCount, os.availableParallelism?.() ?? os.cpus().length, 4));
  const workLimit = Math.max(8_000, Math.floor(limit / workers));

  const results = await Promise.all(
    Array.from({ length: workers }, () => {
      return new Promise((resolve, reject) => {
        const worker = cluster.fork();
        const timeout = setTimeout(() => {
          worker.kill();
          reject(new Error(`Cluster worker ${worker.id} timed out`));
        }, 6_000);

        worker.once('message', (message) => {
          if (message?.type !== 'worker-result') return;
          clearTimeout(timeout);
          worker.kill();
          resolve({
            role: 'cluster-worker',
            workerId: message.workerId,
            pid: message.pid,
            limit: message.limit,
            primes: message.primes,
            durationMs: message.durationMs,
          });
        });

        worker.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        worker.send({ type: 'run-prime-task', limit: workLimit });
      });
    }),
  );

  return {
    concept: 'cluster',
    summary: 'A primary process split CPU work across short-lived cluster workers.',
    totalDurationMs: Math.round(performance.now() - startedAt),
    units: results,
  };
}

async function main() {
  if (!isMainThread || cluster.isWorker) return;

  const safeTaskSize = Number.isFinite(taskSize) ? Math.max(8_000, Math.min(taskSize, 80_000)) : 22_000;
  const safeWorkerCount = Number.isFinite(requestedWorkers) ? Math.max(1, Math.min(requestedWorkers, 4)) : 2;
  let result;

  if (mode === 'worker-thread') {
    result = await runWorkerThreadDemo(safeTaskSize);
  } else if (mode === 'child-process') {
    result = runChildProcessDemo(safeTaskSize);
  } else if (mode === 'cluster') {
    result = await runClusterDemo(safeTaskSize, safeWorkerCount);
  } else {
    throw new Error(`Unsupported Node concept mode: ${mode}`);
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      mode,
      primaryPid: process.pid,
      nodeVersion: process.version,
      ...result,
    }),
  );
}

main().catch((error) => {
  process.stderr.write(error.stack ?? error.message);
  process.exitCode = 1;
});
