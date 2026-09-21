import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Grove, ProjectG } from '../src/store.ts';
import { normalizeRemote } from '../src/git.ts';

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
  assert.match(help, /Grove 0.1/);
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
