import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('../tools/nodeConceptLabRunner.js', import.meta.url));
const TASK_SIZES = {
  light: 18_000,
  standard: 32_000,
  heavy: 48_000,
};

export function getNodeRuntimeSnapshot() {
  const memory = process.memoryUsage();
  const cpus = os.cpus();
  const availableCores = os.availableParallelism?.() ?? cpus.length;

  return {
    process: {
      pid: process.pid,
      ppid: process.ppid,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    cpu: {
      logicalCores: cpus.length,
      availableCores,
      loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
      cores: cpus.slice(0, 16).map((cpu, index) => ({
        id: index + 1,
        model: cpu.model,
        speedMhz: cpu.speed,
        activityScore: getCoreActivityScore(cpu.times),
      })),
    },
    memory: {
      rssMb: bytesToMb(memory.rss),
      heapUsedMb: bytesToMb(memory.heapUsed),
      heapTotalMb: bytesToMb(memory.heapTotal),
      systemFreeMb: bytesToMb(os.freemem()),
      systemTotalMb: bytesToMb(os.totalmem()),
    },
    concepts: [
      {
        mode: 'worker-thread',
        label: 'Worker thread',
        purpose: 'Move CPU-bound JavaScript away from the main event loop.',
      },
      {
        mode: 'child-process',
        label: 'Child process',
        purpose: 'Run isolated automation or CLI-style work with a separate PID.',
      },
      {
        mode: 'cluster',
        label: 'Cluster workers',
        purpose: 'Distribute work across multiple Node worker processes.',
      },
    ],
  };
}

export async function runNodeConceptDemo({ mode, intensity = 'standard' }) {
  const taskSize = TASK_SIZES[intensity] ?? TASK_SIZES.standard;
  const workerCount = Math.min(os.availableParallelism?.() ?? os.cpus().length, 4);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;

    const child = spawn(process.execPath, [runnerPath, mode, String(taskSize), String(workerCount)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_CONCEPT_LAB_CHILD: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      child.kill();
      reject(new Error('Node concept demo timed out before completing.'));
    }, 9_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.once('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr || `Node concept demo exited with code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          ...result,
          requestedMode: mode,
          intensity,
          wallClockMs: Date.now() - startedAt,
          cpu: {
            availableCores: workerCount,
            loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
          },
        });
      } catch {
        reject(new Error('Node concept demo returned invalid JSON.'));
      }
    });
  });
}

function getCoreActivityScore(times) {
  const total = times.user + times.nice + times.sys + times.idle + times.irq;
  if (!total) return 0;
  return Math.round(((total - times.idle) / total) * 100);
}

function bytesToMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
