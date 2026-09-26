import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Grove } from './store.ts';
import { inspect } from './git.ts';
import { manifest } from './files.ts';
import { loadPolicy } from './policy.ts';

export function groveInit(directory = process.cwd(), options: { home?: string; dryRun?: boolean; fork?: boolean } = {}) {
  const info = inspect(directory);
  const home = resolve(options.home || process.env.GROVE_HOME || process.env.PROJECTG_HOME || join(homedir(), '.projectg'));
  const rel = relative(info.root, home);
  if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
    throw new Error('GROVE_HOME must be outside the registered checkout');
  }
  if (options.dryRun) {
    const planned = manifest(info.root, loadPolicy(home));
    return {
      dryRun: true, checkoutPath: info.root, repositoryIdentity: info.identity,
      branch: info.branch, head: info.head, store: home,
      trackedSourceFiles: planned.files.length, skippedTrackedFiles: planned.skipped.length,
      actions: ['register this checkout', 'create or reuse a graph snapshot', 'print an MCP configuration'],
      note: 'No database or repository files were written. Agent configuration is printed, not installed.',
    };
  }
  const store = new Grove(home);
  try {
    const checkout = store.register(info.root, options.fork);
    const indexed = store.index(checkout.id);
    return {
      initialized: true, checkoutId: checkout.id, repositoryId: checkout.repository_id,
      repositoryIdentity: checkout.identity, checkoutPath: checkout.path, branch: checkout.branch,
      snapshotId: indexed.snapshotId, reusedSnapshot: indexed.reused,
      trackedSourceFiles: indexed.files, skippedTrackedFiles: indexed.skipped.length,
      parsedFiles: indexed.parsedFiles, store: store.home,
      mcp: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./mcp.ts', import.meta.url)), '--checkout', checkout.id, '--home', store.home],
      },
      next: 'Add the mcp command and args to your approved offline coding agent. See the MCP example in README.md.',
    };
  } finally { store.close(); }
}
