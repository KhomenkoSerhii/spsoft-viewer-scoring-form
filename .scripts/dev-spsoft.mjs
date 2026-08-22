import { spawn } from 'node:child_process';

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const children = new Set();
let shuttingDown = false;
let shutdownExitCode = 0;

function startService(label, script) {
  const child = spawn(yarnCommand, [script], {
    cwd: process.cwd(),
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

console.log('[dev:spsoft] Starting Viewer on http://localhost:3000');
console.log('[dev:spsoft] Starting host app on http://localhost:5173');

startService('Viewer', 'dev:viewer');
startService('host app', 'dev:host');
