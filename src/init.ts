import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Grove } from './store.ts';
import { inspect } from './git.ts';
import { manifest } from './files.ts';
import { loadPolicy } from './policy.ts';
import { applyAgents, parseAgents, planAgents } from './agents.ts';

export function groveInit(directory = process.cwd(), options: { home?: string; dryRun?: boolean; fork?: boolean; agents?: string } = {}) {
  const info = inspect(directory);
  const home = resolve(options.home || process.env.GROVE_HOME || process.env.PROJECTG_HOME || join(homedir(), '.projectg'));
  const rel = relative(info.root, home);
  if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
    throw new Error('GROVE_HOME must be outside the registered checkout');
  }
  const agents = parseAgents(options.agents);
  const mcp = (id: string) => ({ command: process.execPath,
    args: [fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './mcp.ts' : './mcp.js', import.meta.url)), '--checkout', id, '--home', home] });
  const preview = planAgents(info.root, agents, mcp('<checkout-id>'));
  if (options.dryRun) {
    const planned = manifest(info.root, loadPolicy(home));
    return {
      dryRun: true, checkoutPath: info.root, repositoryIdentity: info.identity,
      branch: info.branch, head: info.head, store: home,
      trackedSourceFiles: planned.files.length, skippedTrackedFiles: planned.skipped.length,
      actions: ['register this checkout', 'create or reuse a graph snapshot', 'print an MCP configuration', ...preview.map(item => `configure ${item.agent} in ${item.path}`)],
      agentFiles: preview.map(({ agent, path }) => ({ agent, path })),
      note: 'No database or repository files were written. Only explicitly selected agents will be configured.',
    };
  }
  const store = new Grove(home);
  try {
    const checkout = store.register(info.root, options.fork);
    const indexed = store.index(checkout.id);
    const configuration = mcp(checkout.id);
    const plan = planAgents(info.root, agents, configuration);
    if (plan.some((item, i) => item.before !== preview[i].before)) throw new Error('Agent configuration changed during indexing; run init again.');
    const configuredAgents = applyAgents(info.root, plan);
    return {
      initialized: true, checkoutId: checkout.id, repositoryId: checkout.repository_id,
      repositoryIdentity: checkout.identity, checkoutPath: checkout.path, branch: checkout.branch,
      snapshotId: indexed.snapshotId, reusedSnapshot: indexed.reused,
      trackedSourceFiles: indexed.files, skippedTrackedFiles: indexed.skipped.length,
      parsedFiles: indexed.parsedFiles, store: store.home,
      mcp: configuration, configuredAgents,
      next: agents.length ? 'Restart your selected client, approve the local Grove MCP server, and ask it to use grove_context. Configuration contains machine-local paths; rerun init after moving or cloning this checkout.' : 'Run grove init --agents claude or --agents copilot to configure a client, or use the printed MCP command with your approved client.',
    };
  } finally { store.close(); }
}
