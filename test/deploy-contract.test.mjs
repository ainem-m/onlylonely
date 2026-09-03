import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [readme, deployGuide, exampleSecrets, wranglerSource, packageSource] = await Promise.all([
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
  readFile(new URL('../DEPLOY.md', import.meta.url), 'utf8'),
  readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8'),
  readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

const packageJson = JSON.parse(packageSource);
const wrangler = JSON.parse(wranglerSource);
const deployUrl = 'https://deploy.workers.cloudflare.com/?url=https://github.com/ainem-m/onlylonely';

test('README and agent guide expose the canonical one-click deployment URL', () => {
  assert.match(readme, new RegExp(deployUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(deployGuide, new RegExp(deployUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(deployGuide, /\/api\/health/);
  assert.match(deployGuide, /\/admin/);
});

test('deployment prerequisites distinguish one-click from CLI requirements', () => {
  for (const requirement of ['Cloudflareアカウント', 'GitHubアカウント', 'SESSION_SECRET', 'ADMIN_SETUP_SECRET', '4〜8桁の管理PIN']) {
    assert.match(readme, new RegExp(requirement));
  }
  assert.match(readme, /独自ドメイン、サーバー、ローカルのNode\.js環境.*不要/);
  assert.match(readme, /Workers Freeプラン/);
  assert.match(readme, /利用上限/);
  assert.match(deployGuide, /D1の読み書きと保存量には利用上限/);
  assert.match(deployGuide, /Node\.js 22以上とターミナルが必要/);
});

test('Cloudflare deployment applies D1 migrations before publishing the Worker', () => {
  assert.equal(packageJson.scripts['db:migrations:apply'], 'wrangler d1 migrations apply DB --remote');
  assert.equal(packageJson.scripts.deploy, 'npm run db:migrations:apply && wrangler deploy');
  assert.equal(wrangler.d1_databases[0].binding, 'DB');
});

test('both required secrets are discoverable without committing real values', () => {
  for (const name of ['SESSION_SECRET', 'ADMIN_SETUP_SECRET']) {
    assert.match(exampleSecrets, new RegExp(`^${name}=`, 'm'));
    assert.ok(wrangler.secrets.required.includes(name));
    assert.equal(typeof packageJson.cloudflare.bindings[name].description, 'string');
  }
  assert.doesNotMatch(exampleSecrets, /[a-f0-9]{64}/i);
});
