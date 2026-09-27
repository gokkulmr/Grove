import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const agentTargets = {
  claude: { path: '.mcp.json', key: 'mcpServers', label: 'Claude Code' },
  copilot: { path: '.vscode/mcp.json', key: 'servers', label: 'GitHub Copilot in VS Code' },
} as const;
export type Agent = keyof typeof agentTargets;
export type McpCommand = { command: string; args: string[] };
const marker = 'GROVE_MANAGED_CONFIG';

export function parseAgents(value = ''): Agent[] {
  const ids = [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))];
  if (ids.length === 1 && ids[0] === 'none') return [];
  for (const id of ids) if (!Object.hasOwn(agentTargets, id)) throw new Error(`Unknown agent "${id}". Use claude,copilot or none.`);
  return ids as Agent[];
}

function readConfig(root: string, path: string): string | null {
  let current = root;
  const parts = relative(root, path).split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = lstatSync(current); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Refusing agent configuration through a symlink: ${current}`);
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Invalid agent configuration path: ${current}`);
    if (i === parts.length - 1 && stat.size > 1024 * 1024) throw new Error(`Agent configuration exceeds 1 MiB: ${path}`);
  }
  return readFileSync(path, 'utf8');
}
const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function planAgents(root: string, agents: Agent[], mcp: McpCommand) {
  return agents.map(agent => {
    const target = agentTargets[agent];
    const path = join(root, target.path);
    const before = readConfig(root, path);
    let document: any = {};
    if (before !== null) {
      try { document = JSON.parse(before); }
      catch { throw new Error(`Cannot safely merge ${target.path}: strict JSON is required. Keep JSONC/comments intact and configure Grove manually.`); }
    }
    if (!object(document) || (Object.hasOwn(document, target.key) && !object(document[target.key]))) throw new Error(`Invalid MCP configuration in ${target.path}`);
    const servers = document[target.key] ?? {};
    if (Object.hasOwn(servers, 'grove') && servers.grove?.env?.[marker] !== '1') throw new Error(`An unmanaged grove server already exists in ${target.path}; rename it or configure Grove manually.`);
    const entry = { type: 'stdio', ...mcp, env: { [marker]: '1' } };
    const after = JSON.stringify({ ...document, [target.key]: { ...servers, grove: entry } }, null, 2) + '\n';
    return { agent, path, before, after, changed: before !== after };
  });
}

export function applyAgents(root: string, plan: ReturnType<typeof planAgents>) {
  // Preflight all targets before writing any. Never silently overwrite concurrent edits.
  for (const change of plan) if (readConfig(root, change.path) !== change.before) throw new Error(`Configuration changed during init: ${change.path}; run init again.`);
  for (const change of plan) {
    if (!change.changed) continue;
    mkdirSync(dirname(change.path), { recursive: true });
    const temp = `${change.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, change.after, { flag: 'wx', mode: 0o600 });
      if (readConfig(root, change.path) !== change.before) throw new Error(`Configuration changed during init: ${change.path}; run init again.`);
      renameSync(temp, change.path);
    } finally {
      try { unlinkSync(temp); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return plan.map(({ agent, path, changed }) => ({ agent, path, changed }));
}
