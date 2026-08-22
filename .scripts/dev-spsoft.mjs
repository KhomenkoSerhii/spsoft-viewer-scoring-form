import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const projectRootUrl = new URL('../', import.meta.url);
const projectRoot = fileURLToPath(projectRootUrl);
const requiredDependencyPaths = [
  'node_modules/.yarn-integrity',
  'node_modules/vite/package.json',
  'node_modules/webpack/package.json',
];
const children = new Set();
let shuttingDown = false;
let shutdownExitCode = 0;

function ensureDependencies() {
  const dependenciesInstalled = requiredDependencyPaths.every(relativePath =>
    existsSync(new URL(relativePath, projectRootUrl))
  );

  if (dependenciesInstalled) {
    console.log('[dev:spsoft] Dependencies are already installed; skipping yarn install.');
    return;
  }

  console.log('[dev:spsoft] Dependencies are missing; running yarn install --frozen-lockfile.');
  const installation = spawnSync(yarnCommand, ['install', '--frozen-lockfile'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (installation.error) {
    console.error('[dev:spsoft] Failed to start dependency installation:', installation.error);
    process.exit(1);
  }

  if (installation.status !== 0) {
    console.error('[dev:spsoft] Dependency installation failed; applications were not started.');
    process.exit(installation.status ?? 1);
  }
}

function startService(label, script) {
  const child = spawn(yarnCommand, [script], {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, OHIF_OPEN: 'false' },
    stdio: 'inherit',
  });

  children.add(child);

  child.once('error', error => {
    console.error(`[dev:spsoft] ${label} failed to start:`, error);
    shutdown(1);
  });

  child.once('exit', (code, signal) => {
    children.delete(child);

    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      console.error(`[dev:spsoft] ${label} stopped unexpectedly (${reason}).`);
      shutdown(code ?? 1);
      return;
    }

    exitWhenStopped();
  });
}

function stopChild(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.error('[dev:spsoft] Failed to stop a child process:', error);
    }
  }
}

function shutdown(exitCode = 0, signal = 'SIGTERM') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownExitCode = exitCode;
  children.forEach(child => stopChild(child, signal));
  exitWhenStopped();
}

function exitWhenStopped() {
  if (shuttingDown && children.size === 0) {
    process.exit(shutdownExitCode);
  }
}

process.once('SIGINT', () => shutdown(0, 'SIGINT'));
process.once('SIGTERM', () => shutdown(0, 'SIGTERM'));

ensureDependencies();

console.log('[dev:spsoft] Starting Viewer on http://localhost:3000');
console.log('[dev:spsoft] Starting host app on http://localhost:5173');

startService('Viewer', 'dev:viewer');
startService('host app', 'dev:host');
