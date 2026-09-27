import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { groveInit } from '../src/init.ts';

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'grove-agent-'));
  const repo = join(root, 'repo'); const home = join(root, 'store');
  mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  writeFileSync(join(repo, 'app.ts'), 'export function retry() { return 3; }\n');
  execFileSync('git', ['-C', repo, 'add', 'app.ts']);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo, home };
}

test('agent init previews all writes, preserves other servers, and is idempotent', t => {
  const { repo, home } = fixture(t);
  const path = join(repo, '.mcp.json');
  const other = { mcpServers: { existing: { command: 'example', args: ['safe'] } }, custom: 7 };
  writeFileSync(path, JSON.stringify(other));
  const preview = groveInit(repo, { home, agents: 'claude,copilot', dryRun: true });
  assert.equal(preview.agentFiles?.length, 2);
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(join(repo, '.vscode')), false);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), other);
  const first = groveInit(repo, { home, agents: 'claude,copilot' });
  const document = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(document.mcpServers.existing, other.mcpServers.existing);
  assert.equal(document.custom, 7);
  assert.deepEqual(document.mcpServers.grove.args, first.mcp?.args);
  assert.equal(JSON.parse(readFileSync(join(repo, '.vscode/mcp.json'), 'utf8')).servers.grove.type, 'stdio');
  const second = groveInit(repo, { home, agents: 'claude,copilot' });
  assert.equal(second.checkoutId, first.checkoutId);
  assert.ok(second.configuredAgents?.every(agent => !agent.changed));
});

test('agent setup fails before writes on malformed JSON, unmanaged entries, or unknown agents', t => {
  const { repo, home } = fixture(t);
  mkdirSync(join(repo, '.vscode'));
  const path = join(repo, '.vscode/mcp.json');
  writeFileSync(path, '{ // user comments\n}');
  assert.throws(() => groveInit(repo, { home, agents: 'claude,copilot' }), /strict JSON/);
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(join(repo, '.mcp.json')), false);
  writeFileSync(path, JSON.stringify({ servers: { grove: { command: 'custom' } } }));
  assert.throws(() => groveInit(repo, { home, agents: 'copilot' }), /unmanaged/);
  assert.throws(() => groveInit(repo, { home, agents: 'unknown' }), /Unknown agent/);
  assert.equal(existsSync(home), false);
});

test('agent setup refuses symlinked configuration directories', t => {
  const { root, repo, home } = fixture(t);
  const outside = join(root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(repo, '.vscode'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => groveInit(repo, { home, agents: 'copilot' }), /symlink/);
  assert.equal(existsSync(join(outside, 'mcp.json')), false);
  assert.equal(existsSync(home), false);
});
