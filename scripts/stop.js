import dotenv from 'dotenv';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = path.join(__dirname, '../.server.pid');
const GRACE_PERIOD_MS = 10_000;
const POLL_INTERVAL_MS = 250;

const port = Number(process.env.PORT) || 3000;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function findPidsOnPort(targetPort) {
  try {
    const output = execSync(`lsof -ti:${targetPort}`, { encoding: 'utf8' }).trim();
    if (!output) return [];
    return [...new Set(output.split('\n').map((value) => Number(value)).filter(Boolean))];
  } catch {
    return [];
  }
}

function removePidFile() {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectPids() {
  const pids = new Set();
  const fromFile = readPidFile();
  if (fromFile) pids.add(fromFile);
  for (const pid of findPidsOnPort(port)) {
    pids.add(pid);
  }
  return [...pids].filter(isAlive);
}

async function stopPid(pid) {
  if (!isAlive(pid)) return 'already_stopped';

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') return 'already_stopped';
    throw err;
  }

  const deadline = Date.now() + GRACE_PERIOD_MS;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return 'graceful';
    await sleep(POLL_INTERVAL_MS);
  }

  if (!isAlive(pid)) return 'graceful';

  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    if (err.code === 'ESRCH') return 'already_stopped';
    throw err;
  }

  await sleep(POLL_INTERVAL_MS);
  return isAlive(pid) ? 'failed' : 'forced';
}

async function main() {
  const pids = collectPids();

  if (pids.length === 0) {
    removePidFile();
    console.log(`No running server found on port ${port}.`);
    return;
  }

  console.log(`Stopping server (port ${port}, PID${pids.length > 1 ? 's' : ''}: ${pids.join(', ')})...`);

  for (const pid of pids) {
    const result = await stopPid(pid);
    if (result === 'graceful') {
      console.log(`PID ${pid} stopped gracefully.`);
    } else if (result === 'forced') {
      console.log(`PID ${pid} force-killed after ${GRACE_PERIOD_MS / 1000}s timeout.`);
    } else if (result === 'failed') {
      console.error(`Failed to stop PID ${pid}.`);
      process.exitCode = 1;
    }
  }

  removePidFile();

  const remaining = findPidsOnPort(port);
  if (remaining.length > 0) {
    console.error(`Port ${port} is still in use by PID(s): ${remaining.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Server stopped.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
