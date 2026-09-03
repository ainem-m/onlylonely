import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const setupSecret = 'e2e-admin-setup-7f3a9c2d8b6e4f1a';
const sessionSecret = 'e2e-session-4d8c6a2f9b1e7c3d5a0f';
const groups = [
  ['smoke.mjs', 'auth-lockout.mjs'],
  ['auto-close.mjs'],
  ['load.mjs'],
  ['multi-round.mjs', 'retention.mjs'],
  ['self-registration.mjs'],
  ['setup-expansion.mjs'],
];

const waitForHealth = async (base, worker) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Wrangler exited before readiness with ${worker.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Wrangler did not become ready at ${base}`);
};

for (const [groupIndex, group] of groups.entries()) {
  const port = 8900 + groupIndex;
  const base = `http://127.0.0.1:${port}`;
  const persistTo = mkdtempSync(join(tmpdir(), `only-lonely-e2e-${groupIndex}-`));
  const logPath = join(persistTo, 'wrangler.log');
  const envFile = join(persistTo, 'e2e.env');
  writeFileSync(envFile, `SESSION_SECRET="${sessionSecret}"\nADMIN_SETUP_SECRET="${setupSecret}"\n`, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  const sharedEnv = {
    ...process.env,
    WRANGLER_LOG_PATH: logPath,
    TEST_BASE_URL: base,
    TEST_D1_PERSIST_TO: persistTo,
    TEST_ADMIN_SETUP_SECRET: setupSecret,
  };
  const migration = spawnSync(wrangler, [
    'd1', 'migrations', 'apply', 'only-lonely-db', '--local', '--persist-to', persistTo,
  ], { cwd: root, env: sharedEnv, encoding: 'utf8' });
  if (migration.status !== 0) {
    process.stderr.write(migration.stdout || '');
    process.stderr.write(migration.stderr || '');
    throw new Error(`Migration failed for ${group.join(', ')}`);
  }

  const worker = spawn(wrangler, [
    'dev', '--local', '--port', String(port), '--persist-to', persistTo,
    '--env-file', envFile,
  ], { cwd: root, env: sharedEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let workerOutput = '';
  worker.stdout.on('data', (chunk) => { workerOutput += chunk; });
  worker.stderr.on('data', (chunk) => { workerOutput += chunk; });

  try {
    await waitForHealth(base, worker);
    for (const file of group) {
      const result = spawnSync(process.execPath, [resolve(root, 'test', file)], {
        cwd: root,
        env: sharedEnv,
        encoding: 'utf8',
        timeout: 120_000,
      });
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      if (result.status !== 0) throw new Error(`${file} failed with ${result.status}`);
    }
  } catch (error) {
    process.stderr.write(`\nWrangler output for ${group.join(', ')}:\n${workerOutput}\n`);
    if (logPath) {
      try { process.stderr.write(readFileSync(logPath, 'utf8')); } catch {}
    }
    process.stderr.write(`E2E state preserved at ${persistTo}\n`);
    throw error;
  } finally {
    worker.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (worker.exitCode !== null) return resolveExit();
      const timeout = setTimeout(() => worker.kill('SIGKILL'), 3_000);
      worker.once('exit', () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
  }
  rmSync(persistTo, { recursive: true, force: true });
}

console.log(`E2E passed: ${groups.flat().length} scenarios in isolated local D1 databases`);
