import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Grove, ProjectG } from '../src/store.ts';
import { normalizeRemote } from '../src/git.ts';
import { context } from '../src/context.ts';

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=Grove Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'projectg-test-'));
  const home = join(root, 'store');
  const repo = join(root, 'app');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/app.git');
  writeFileSync(join(repo, 'app.ts'), 'export const retry = 3;\n');
  git(repo, 'add', 'app.ts'); git(repo, 'commit', '-m', 'fixture');
  const store = new Grove(home);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, home, repo, store };
}

test('normalizes GitHub SSH/HTTPS without persisting credentials; separates hosts', () => {
  assert.equal(normalizeRemote('git@github.com:Example/App.git', '/tmp'), 'github.com/example/app');
  assert.equal(normalizeRemote('https://name:secret@github.com/Example/App.git?token=secret', '/tmp'), 'github.com/example/app');
  assert.equal(normalizeRemote('ssh://git@github.com/Example/App.git', '/tmp'), 'github.com/example/app');
  assert.notEqual(normalizeRemote('https://internal.example/Example/App.git', '/tmp'), 'github.com/example/app');
  assert.throws(() => normalizeRemote('file://server/share/app', '/tmp'), /Network/);
});

test('delete and independently re-clone preserves reviewed memory and reuses snapshots', t => {
  const { root, repo, store } = fixture(t);
  const a = store.register(repo);
  const first = store.index(a.id);
  store.remember(a.id, 'Retry is three.', 'app.ts', true);
  const clone = join(root, 'clone');
  git(root, 'clone', '--no-local', repo, clone);
  git(clone, 'remote', 'set-url', 'origin', 'git@github.com:example/app.git');
  rmSync(repo, { recursive: true });
  assert.equal(store.refresh(a.id).status, 'missing');
  assert.equal(store.markDeleted(a.id).status, 'deleted');
  assert.equal(store.refresh(a.id).status, 'deleted');
  const b = store.register(clone);
  assert.equal(a.repository_id, b.repository_id);
  const next = store.index(b.id);
  assert.equal(next.snapshotId, first.snapshotId);
  assert.equal(next.reused, true);
  assert.equal(store.memories(b.id)[0].freshness, 'matching');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM snapshots').get()?.n, 1);
});

test('same commit and branch with different dirty files creates isolated snapshots', t => {
  const { root, repo, store } = fixture(t);
  const clone = join(root, 'clone');
  git(root, 'clone', repo, clone);
  git(clone, 'remote', 'set-url', 'origin', 'https://github.com/example/app.git');
  const a = store.register(repo); const b = store.register(clone);
  store.remember(a.id, 'Three retries.', 'app.ts', true);
  const before = store.index(a.id);
  writeFileSync(join(clone, 'app.ts'), 'export const retry = 7;\n');
  const after = store.index(b.id);
  assert.notEqual(before.snapshotId, after.snapshotId);
  assert.equal(store.checkout(a.id).snapshot_id, before.snapshotId);
  assert.equal(store.memories(a.id)[0].freshness, 'matching');
  assert.equal(store.memories(b.id)[0].freshness, 'stale');
});

test('branch switching and linked worktrees use the correct snapshot', t => {
  const { root, repo, store } = fixture(t);
  const a = store.register(repo); const baseline = store.index(a.id);
  const worktree = join(root, 'worktree');
  git(repo, 'worktree', 'add', '-b', 'feature', worktree);
  const b = store.register(worktree);
  assert.equal(a.repository_id, b.repository_id);
  writeFileSync(join(worktree, 'app.ts'), 'export const retry = 9;\n');
  git(worktree, 'add', 'app.ts'); git(worktree, 'commit', '-m', 'feature');
  assert.notEqual(store.index(b.id).snapshotId, baseline.snapshotId);
  assert.equal(store.index(a.id).snapshotId, baseline.snapshotId);
});

test('origin changes require explicit fork; prior memory does not leak', t => {
  const { repo, store } = fixture(t);
  const a = store.register(repo);
  store.remember(a.id, 'Original repo decision.');
  store.index(a.id);
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/another/app.git');
  assert.equal(store.refresh(a.id).status, 'identity-changed');
  assert.throws(() => store.index(a.id), /identity-changed/);
  assert.throws(() => store.register(repo), /--fork/);
  const fork = store.register(repo, true);
  assert.notEqual(a.repository_id, fork.repository_id);
  assert.equal(fork.snapshot_id, null);
  assert.equal(store.memories(fork.id).length, 0);
  assert.equal(store.db.prepare('SELECT derived_from FROM repositories WHERE id=?').get(fork.repository_id)?.derived_from, a.repository_id);
});

test('merge conflicts block new graphs until resolved; completed snapshot remains', t => {
  const { repo, store } = fixture(t);
  const a = store.register(repo); const before = store.index(a.id);
  git(repo, 'checkout', '-b', 'other');
  writeFileSync(join(repo, 'app.ts'), 'export const retry = 4;\n');
  git(repo, 'commit', '-am', 'other');
  git(repo, 'checkout', 'main');
  writeFileSync(join(repo, 'app.ts'), 'export const retry = 5;\n');
  git(repo, 'commit', '-am', 'main');
  assert.throws(() => git(repo, 'merge', 'other'));
  assert.equal(store.refresh(a.id).status, 'conflicted');
  assert.throws(() => store.graph(a.id), /conflicted/);
  assert.equal(store.checkout(a.id).snapshot_id, before.snapshotId);
  writeFileSync(join(repo, 'app.ts'), 'export const retry = 6;\n');
  git(repo, 'add', 'app.ts'); git(repo, 'commit', '-m', 'resolved');
  assert.equal(store.refresh(a.id).status, 'available');
  assert.notEqual(store.index(a.id).snapshotId, before.snapshotId);
});

test('tracked source allowlist excludes secrets, untracked files, and symlinks', t => {
  const { root, repo, store } = fixture(t);
  writeFileSync(join(repo, '.env'), 'SECRET=do-not-store');
  writeFileSync(join(repo, 'untracked.ts'), 'private draft');
  writeFileSync(join(root, 'outside.ts'), 'private outside');
  symlinkSync(join(root, 'outside.ts'), join(repo, 'link.ts'));
  git(repo, 'add', '.env', 'link.ts');
  const a = store.register(repo); const graph = store.graph(a.id);
  assert.deepEqual(graph.nodes.filter(n => n.kind === 'file').map(n => n.id), ['app.ts']);
  assert(graph.skipped.includes('link.ts')); assert(graph.skipped.includes('.env'));
  assert.throws(() => store.remember(a.id, 'secret', '../outside.ts', true), /indexed tracked/);
  assert.throws(() => store.remember(a.id, 'secret', 'link.ts', true), /indexed tracked/);
});

test('unstaged deletion invalidates evidence and does not erase memory', t => {
  const { repo, store } = fixture(t); const a = store.register(repo);
  store.remember(a.id, 'Decision', 'app.ts', true);
  rmSync(join(repo, 'app.ts'));
  assert.equal(store.memories(a.id)[0].freshness, 'stale');
  assert.equal(store.graph(a.id).files, 0);
});

test('availability is not deletion; an existing checkout cannot be marked deleted', t => {
  const { repo, store } = fixture(t); const a = store.register(repo);
  assert.throws(() => store.markDeleted(a.id), /Only a missing/);
  rmSync(repo, { recursive: true });
  assert.equal(store.list().checkouts[0].status, 'missing');
  mkdirSync(repo);
  assert.equal(store.refresh(a.id).status, 'inaccessible');
});

test('database persists across sessions and rolls back incomplete writes', t => {
  const { home, repo, store } = fixture(t); const a = store.register(repo);
  store.index(a.id); store.remember(a.id, 'Unverified thought');
  assert.throws(() => store.transaction(() => {
    store.db.prepare('DELETE FROM memories').run(); throw new Error('interrupted');
  }));
  const reader = new Grove(home);
  try {
    assert.equal(reader.memories(a.id)[0].freshness, 'unknown');
    assert.equal(reader.index(a.id).reused, true);
  } finally { reader.close(); }
});

test('store inside checkout is rejected', t => {
  const { repo } = fixture(t); const nested = new Grove(join(repo, '.projectg'));
  try { assert.throws(() => nested.register(repo), /outside/); } finally { nested.close(); }
});

test('CLI help needs no store and errors use a failing exit status', () => {
  const cli = resolve('src/cli.ts');
  const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.match(help, /No network/);
  assert.match(help, /Grove 0.3/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'mark-deleted', 'x'], { stdio: 'pipe' }), /Command failed/);
});

test('Grove and legacy environment settings reopen retained memory', t => {
  const { home, root, repo, store } = fixture(t);
  assert.equal(ProjectG, Grove);
  const checkout = store.register(repo);
  store.remember(checkout.id, 'Retained through the rename');
  const cli = resolve('src/cli.ts');
  const env = { ...process.env, PROJECTG_HOME: home };
  delete env.GROVE_HOME;
  const legacy = JSON.parse(execFileSync(process.execPath, [cli, 'status'], { env, encoding: 'utf8' }));
  assert.equal(legacy.checkouts[0].id, checkout.id);
  const renamed = JSON.parse(execFileSync(process.execPath, [cli, 'memories', checkout.id], {
    env: { ...env, GROVE_HOME: home, PROJECTG_HOME: join(root, 'unused') }, encoding: 'utf8',
  }));
  assert.equal(renamed[0].statement, 'Retained through the rename');
});

test('runtime has no dependencies or networking imports; only fixed local Git subprocesses', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  for (const file of readdirSync('src')) {
    const source = readFileSync(join('src', file), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"](?:node:)?(?:https?|https?2|net|tls|dns|dgram|undici)['"]/);
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket)\s*\(/);
    if (file !== 'git.ts') assert.doesNotMatch(source, /node:child_process/);
  }
});

test('context uses current checkout evidence, excludes candidates and enforces UTF-8 budgets', t => {
  const { store, repo } = fixture(t);
  const checkout = store.register(repo);
  store.remember(checkout.id, 'retry candidate must stay out');
  store.remember(checkout.id, 'retry is bounded', 'app.ts', true);
  for (let i = 0; i < 5; i++) store.remember(checkout.id, `retry ${i} ${'界'.repeat(800)}`, 'app.ts', true);
  const small = context(store, checkout.id, 'retry app', 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(small)) <= 1024);
  assert.ok(small.omitted > 0);
  assert.equal(small.withheldMemories, 1);
  assert.ok(small.items.every(item => !item.statement?.includes('candidate')));
  assert.deepEqual(context(store, checkout.id, 'retry app', 1024), small);
  writeFileSync(join(repo, 'app.ts'), 'export const retry = 4;\n');
  const changed = context(store, checkout.id, 'retry');
  assert.notEqual(changed.snapshotId, small.snapshotId);
  assert.equal(changed.items.length, 0);
  assert.equal(changed.withheldMemories, 7);
  assert.throws(() => context(store, checkout.id, '   '), /Query/);
  assert.throws(() => context(store, checkout.id, 'retry', 1), /maxBytes/);
  rmSync(repo, { recursive: true });
  assert.throws(() => context(store, checkout.id, 'retry'), /missing/);
});

test('MCP stdio negotiates, binds one checkout and handles malformed requests', t => {
  const { store, home, repo } = fixture(t);
  const checkout = store.register(repo);
  store.remember(checkout.id, 'retry is bounded', 'app.ts', true);
  const rpc = (id: number, method: string, params?: any) => ({ jsonrpc: '2.0', id, method, params });
  const messages = [
    rpc(0, 'tools/list'),
    rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc(2, 'tools/list'),
    rpc(3, 'tools/call', { name: 'grove_context', arguments: { query: 'retry', maxBytes: 1024 } }),
    rpc(4, 'tools/call', { name: 'grove_context', arguments: { query: 'retry', checkoutId: 'other' } }),
    rpc(5, 'tools/call', { name: 'grove_context', arguments: { query: '' } }),
    rpc(6, 'unknown'),
  ];
  const output = execFileSync(process.execPath, [resolve('src/mcp.ts'), '--home', home, '--checkout', checkout.id], {
    input: messages.map(message => JSON.stringify(message)).join('\n') + '\n{bad}\n', encoding: 'utf8', timeout: 20000,
  }).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(output.length, 8);
  assert.equal(output[0].error.code, -32002);
  assert.equal(output[1].result.protocolVersion, '2025-06-18');
  assert.equal(output[2].result.tools[0].name, 'grove_context');
  const data = JSON.parse(output[3].result.content[0].text);
  assert.equal(data.checkoutId, checkout.id);
  assert.equal(data.items[0].statement, 'retry is bounded');
  assert.ok(Buffer.byteLength(output[3].result.content[0].text) <= 1024);
  assert.equal(output[4].error.code, -32602);
  assert.equal(output[5].result.isError, true);
  assert.equal(output[6].error.code, -32601);
  assert.equal(output[7].error.code, -32700);
});

test('MCP fails closed on oversized and incomplete input', t => {
  const { store, home, repo } = fixture(t);
  const checkout = store.register(repo);
  for (const input of ['x'.repeat(65537), '{"jsonrpc":"2.0"}']) {
    assert.throws(() => execFileSync(process.execPath, [resolve('src/mcp.ts'), '--home', home, '--checkout', checkout.id], {
      input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }), /Command failed/);
  }
});

test('bundled parsers build symbols/imports and reuse parsed artifacts across edits', t => {
  const { repo, store } = fixture(t);
  writeFileSync(join(repo, 'helper.ts'), 'export function helper() { return 1; }\n');
  writeFileSync(join(repo, 'module.py'), 'from pathlib import Path\nclass Worker:\n    def run(self):\n        pass\n');
  writeFileSync(join(repo, 'app.ts'), 'import { helper } from "./helper";\nexport function retry() { return helper(); }\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'parser fixture');
  const id = store.register(repo).id;
  const first = store.graph(id);
  assert.ok(first.nodes.some((n: any) => n.kind === 'function' && n.name === 'retry'));
  assert.ok(first.nodes.some((n: any) => n.kind === 'class' && n.name === 'Worker'));
  assert.ok(first.nodes.some((n: any) => n.kind === 'method' && n.name === 'run'));
  assert.ok(first.nodes.some((n: any) => n.kind === 'module' && n.name === 'pathlib'));
  assert.ok(first.edges.some((e: any) => e.relation === 'imports' && e.target === 'helper.ts'));
  assert.equal(first.parseErrors, 0);
  assert.equal(store.index(id).cacheHits, 3);
  writeFileSync(join(repo, 'app.ts'), 'export class RetryPolicy {}\n');
  const changed = store.graph(id);
  assert.notEqual(changed.snapshotId, first.snapshotId);
  assert.ok(changed.nodes.some((n: any) => n.kind === 'class' && n.name === 'RetryPolicy'));
  assert.equal(changed.nodes.some((n: any) => n.kind === 'function' && n.name === 'retry'), false);
  assert.ok(changed.cacheHits >= 2);
  const hits = context(store, id, 'RetryPolicy');
  assert.ok(hits.items.some((i: any) => i.kind === 'symbol' && i.name === 'RetryPolicy'));
});

test('policy exclusions invalidate snapshots and withhold previously reviewed evidence', t => {
  const { repo, home, store } = fixture(t);
  const id = store.register(repo).id;
  store.remember(id, 'Retry policy', 'app.ts', true);
  const before = store.index(id).snapshotId;
  writeFileSync(join(home, 'policy.json'), JSON.stringify({ denyPrefixes: ['app.ts'], sourceSearch: false }));
  const graph = store.graph(id);
  assert.notEqual(graph.snapshotId, before);
  assert.equal(graph.files, 0);
  assert.equal(context(store, id, 'Retry').withheldMemories, 1);
  assert.throws(() => { writeFileSync(join(home, 'policy.json'), JSON.stringify({ maxFileBytes: 99999999 })); store.graph(id); }, /policy limits/);
});

test('consistent backup restores memory, rejects invalid files and never overwrites', t => {
  const { root, repo, store } = fixture(t);
  const id = store.register(repo).id;
  store.index(id); store.remember(id, 'Retained evidence', 'app.ts', true);
  const backup = join(root, 'grove-backup.sqlite');
  const cli = resolve('src/cli.ts');
  execFileSync(process.execPath, [cli, 'backup', backup, '--home', store.home], { encoding: 'utf8' });
  assert.throws(() => execFileSync(process.execPath, [cli, 'backup', backup, '--home', store.home], { stdio: 'pipe' }));
  const restored = join(root, 'restored');
  execFileSync(process.execPath, [cli, 'restore', backup, restored], { encoding: 'utf8' });
  const copy = new Grove(restored);
  try { assert.equal(copy.memories(id)[0].statement, 'Retained evidence'); }
  finally { copy.close(); }
  assert.throws(() => execFileSync(process.execPath, [cli, 'restore', backup, restored], { stdio: 'pipe' }));
  const broken = join(root, 'broken.sqlite'); writeFileSync(broken, 'broken');
  assert.throws(() => execFileSync(process.execPath, [cli, 'restore', broken, join(root, 'invalid')], { stdio: 'pipe' }));
});

test('opt-in source search reports line numbers without retaining source text', t => {
  const { repo, home, store } = fixture(t);
  writeFileSync(join(repo, 'app.ts'), 'const secretMarker = "superSecretValue";\nexport const answer = 42;\n');
  const id = store.register(repo).id;
  assert.equal(context(store, id, 'superSecretValue').items.some((i: any) => i.kind === 'source-match'), false);
  writeFileSync(join(home, 'policy.json'), JSON.stringify({ sourceSearch: true }));
  const found = context(store, id, 'superSecretValue');
  assert.ok(found.items.some((i: any) => i.kind === 'source-match' && i.line === 1));
  assert.equal(found.sourceSearched, 1);
  assert.equal(JSON.stringify(found).includes('const secretMarker'), false);
  assert.equal(JSON.stringify(found).includes('superSecretValue'), false);
});
