import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Grove } from '../src/store.ts';
import { exportMemories, importMemories, reviewMemory } from '../src/exchange.ts';
import { context } from '../src/context.ts';
import { suggestPrompt } from '../src/suggest.ts';

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'grove-exchange-'));
  const create = (name: string, origin = 'https://github.com/example/app.git') => {
    const repo = join(root, name); mkdirSync(repo);
    execFileSync('git', ['init', repo], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin]);
    writeFileSync(join(repo, 'app.ts'), 'export function retry() { return "SOURCE_ONLY_MARKER"; }\n');
    execFileSync('git', ['-C', repo, 'add', 'app.ts']);
    const store = new Grove(join(root, name + '-store'));
    t.after(() => store.close());
    return { repo, store, id: store.register(repo).id };
  };
  // Close stores before cleanup, including on Windows.
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  const donor = create('donor'); const receiver = create('receiver');
  t.after(cleanup);
  const file = join(root, 'memory.json');
  donor.store.remember(donor.id, 'retry must remain bounded', 'app.ts', true);
  donor.store.remember(donor.id, 'retry unreviewed candidate', 'app.ts');
  return { root, file, donor, receiver, create };
}

test('manual memory exchange previews, deduplicates, retains provenance and requires review', t => {
  const { file, donor, receiver } = fixture(t);
  const cli = (home: string, ...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve('src/cli.ts'), ...args, '--home', home], { encoding: 'utf8' }));
  assert.equal(cli(donor.store.home, 'export', donor.id, file).exported, 1);
  const bytes = readFileSync(file, 'utf8');
  assert.doesNotMatch(bytes, /SOURCE_ONLY_MARKER|unreviewed candidate/);
  assert.ok(!bytes.includes(donor.repo));
  assert.throws(() => exportMemories(donor.store, donor.id, file), /EEXIST/);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  const preview = cli(receiver.store.home, 'import', receiver.id, file, '--dry-run');
  assert.equal(preview.wouldImport, 1);
  assert.equal(receiver.store.memories(receiver.id).length, 0);
  const imported = importMemories(receiver.store, receiver.id, file);
  const memoryId = imported.candidates[0].memoryId;
  const memory = receiver.store.memories(receiver.id)[0];
  assert.equal(memory.state, 'candidate');
  assert.ok(memory.imported.bundle_hash);
  assert.equal(context(receiver.store, receiver.id, 'retry').items.filter(item => item.kind === 'memory').length, 0);
  assert.throws(() => execFileSync(process.execPath, [resolve('src/cli.ts'), 'review', receiver.id, memoryId, '--home', receiver.store.home], { stdio: 'pipe' }));
  cli(receiver.store.home, 'review', receiver.id, memoryId, '--confirm');
  assert.equal(context(receiver.store, receiver.id, 'retry').items.filter(item => item.kind === 'memory').length, 1);
  assert.equal(importMemories(receiver.store, receiver.id, file).duplicate, 1);
  assert.equal(receiver.store.memories(receiver.id)[0].state, 'reviewed');
});

test('imported stale evidence cannot be approved or used in suggestions', t => {
  const { file, donor, receiver } = fixture(t);
  exportMemories(donor.store, donor.id, file);
  writeFileSync(join(receiver.repo, 'app.ts'), 'export function retry() { return 99; }\n');
  const imported = importMemories(receiver.store, receiver.id, file);
  assert.throws(() => reviewMemory(receiver.store, receiver.id, imported.candidates[0].memoryId), /stale/);
  assert.equal(receiver.store.memories(receiver.id)[0].freshness, 'stale');
  assert.doesNotMatch(suggestPrompt(receiver.store, receiver.id, 'Fix retry').suggestedPrompt, /must remain bounded/);
});

test('invalid bundles and wrong repository identity fail without partial memory writes', t => {
  const { file, root, donor, receiver } = fixture(t);
  exportMemories(donor.store, donor.id, file);
  const valid = JSON.parse(readFileSync(file, 'utf8'));
  const bad = join(root, 'bad.json');
  for (const change of [
    { ...valid, version: 99 },
    { ...valid, repositoryKey: '0'.repeat(64) },
    { ...valid, memories: [...valid.memories, { ...valid.memories[0], evidencePath: '../private.ts' }] },
    { ...valid, memories: [{ ...valid.memories[0], evidenceHash: 'bad' }] },
    { ...valid, memories: [{ ...valid.memories[0], statement: 'x'.repeat(4001) }] },
    { ...valid, extra: 'unexpected' },
  ]) {
    writeFileSync(bad, JSON.stringify(change));
    assert.throws(() => importMemories(receiver.store, receiver.id, bad));
    assert.equal(receiver.store.db.prepare('SELECT count(*) AS n FROM memories').get()?.n, 0);
  }
  writeFileSync(bad, 'x'.repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => importMemories(receiver.store, receiver.id, bad), /4 MiB/);
});

test('different statements with the same evidence remain separate candidates', t => {
  const { file, donor, receiver } = fixture(t);
  receiver.store.remember(receiver.id, 'retry uses another policy', 'app.ts', true);
  exportMemories(donor.store, donor.id, file);
  const imported = importMemories(receiver.store, receiver.id, file);
  assert.equal(imported.candidates[0].sameEvidenceOtherStatements, 1);
  const rows = receiver.store.memories(receiver.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => row.state === 'reviewed').length, 1);
});

test('prompt suggestions preserve intent, bound UTF-8 bytes and include only reviewed current evidence', t => {
  const { donor } = fixture(t);
  const original = 'Fix retry without changing the public API. Keep this exact wording: café 🌱';
  const result = suggestPrompt(donor.store, donor.id, original, 1024);
  assert.equal(result.originalPrompt, original);
  assert.ok(result.suggestedPrompt.startsWith(original));
  assert.ok(Buffer.byteLength(result.suggestedPrompt) <= 1024);
  assert.equal(result.suggestedBytes, Buffer.byteLength(result.suggestedPrompt));
  assert.match(result.suggestedPrompt, /must remain bounded/);
  assert.doesNotMatch(result.suggestedPrompt, /unreviewed candidate|SOURCE_ONLY_MARKER/);
  assert.equal(suggestPrompt(donor.store, donor.id, 'zzzzunmatched').suggestedPrompt, 'zzzzunmatched');
  assert.throws(() => suggestPrompt(donor.store, donor.id, '🌱'.repeat(300), 1024), /exceeds/);
});
