import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('offline tarball installs without a source clone and serves MCP from installed JavaScript', t => {
  const root = mkdtempSync(join(tmpdir(), 'grove-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, npm_config_cache: join(root, 'cache'), npm_config_update_notifier: 'false' };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, timeout: 60000, ...options });
  run(process.execPath, ['scripts/build.mjs']);
  const [pack] = JSON.parse(run(npm, ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root]));
  assert.ok(pack.files.some(file => file.path === 'dist/cli.js'));
  assert.ok(pack.files.some(file => file.path === 'vendor/tree-sitter/tree-sitter-python.wasm'));
  assert.ok(pack.files.every(file => !/^(src|test|scripts)\//.test(file.path)));
  const prefix = join(root, 'install');
  run(npm, ['install', '--global', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)]);
  const packageDir = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'grove');
  const cli = join(packageDir, 'dist/cli.js');
  assert.equal(existsSync(join(packageDir, 'src')), false);
  assert.match(run(process.execPath, [cli, '--help']), /0.4.0-rc.1/);
  if (process.platform !== 'win32') assert.match(run(join(prefix, 'bin/grove'), ['--help']), /init/);
  const repo = join(root, 'existing-project'); mkdirSync(repo);
  run('git', ['init', repo]);
  writeFileSync(join(repo, 'app.ts'), 'export function retry() { return 3; }\n');
  run('git', ['-C', repo, 'add', 'app.ts']);
  const home = join(root, 'store');
  const init = JSON.parse(run(process.execPath, [cli, 'init', '--agents', 'claude,copilot', '--home', home], { cwd: repo }));
  assert.equal(init.trackedSourceFiles, 1);
  assert.equal(init.parsedFiles, 1);
  assert.equal(init.mcp.args[0], realpathSync(join(packageDir, 'dist/mcp.js')));
  const config = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8')).mcpServers.grove;
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'package-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'grove_context', arguments: { query: 'retry' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'grove_suggest_prompt', arguments: { prompt: 'Fix retry', maxBytes: 1024 } } },
  ];
  const responses = run(config.command, config.args, { cwd: root, input: requests.map(value => JSON.stringify(value)).join('\n') + '\n' }).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses[1].result.tools[0].name, 'grove_context');
  assert.notEqual(responses[2].result.isError, true);
  assert.match(JSON.stringify(responses[2]), /app\.ts/);
  const suggestion = JSON.parse(responses[3].result.content[0].text);
  assert.equal(suggestion.originalPrompt, 'Fix retry');
  assert.ok(suggestion.suggestedPrompt.startsWith('Fix retry'));
  assert.ok(Buffer.byteLength(suggestion.suggestedPrompt) <= 1024);
});
