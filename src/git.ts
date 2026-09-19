import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

// All Git operations are fixed here. There is no arbitrary-command API and no
// fetch/pull/push, credential helper, remote transport, or blob lazy-fetch path.
const queries = {
  root: ['rev-parse', '--show-toplevel'],
  common: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  origin: ['config', '--local', '--get', 'remote.origin.url'],
  head: ['rev-parse', '--verify', 'HEAD'],
  branch: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
  files: ['ls-files', '--cached', '-z'],
  conflicts: ['ls-files', '--unmerged', '-z'],
} as const;

export function localGit(root: string, query: keyof typeof queries, optional = false): string {
  try {
    return execFileSync('git', [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      ...queries[query],
    ], {
      cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SystemRoot: process.env.SystemRoot, TMPDIR: process.env.TMPDIR,
        LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0',
        GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    });
  } catch (error: any) {
    // Only expected absence (unset origin / unborn or detached HEAD) is optional.
    if (optional && typeof error.status === 'number' && [1, 128].includes(error.status)) return '';
    throw new Error(`Local Git ${query} query failed. Check Git installation and checkout access.`);
  }
}

export function normalizeRemote(raw: string, root: string): string {
  const remote = raw.trim();
  if (!remote) throw new Error('Empty remote');
  // SCP-style SSH URLs; do not misinterpret Windows drive paths.
  const scp = !remote.includes('://') && !/^[A-Za-z]:[\\/]/.test(remote)
    ? remote.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/) : null;
  if (scp) return normalizeHosted(scp[1], scp[2]);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    const url = new URL(remote);
    if (url.protocol === 'file:') {
      if (url.hostname && url.hostname !== 'localhost') throw new Error('Network file remotes are unsupported');
      return `local:${resolve(decodeURIComponent(url.pathname))}`;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) throw new Error('Unsupported remote format');
    // Credentials, URL query parameters and fragments are never persisted.
    return normalizeHosted(url.host, url.pathname);
  }
  return `local:${resolve(root, remote)}`;
}

function normalizeHosted(host: string, path: string): string {
  const hostname = host.toLowerCase();
  let repoPath = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!repoPath || repoPath.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Invalid repository remote');
  // GitHub is case-insensitive; other forge path semantics vary.
  if (hostname === 'github.com') repoPath = repoPath.toLowerCase();
  return `${hostname}/${repoPath}`;
}

export function inspect(path: string) {
  const root = realpathSync(localGit(resolve(path), 'root').trim());
  const common = realpathSync(localGit(root, 'common').trim());
  const remote = localGit(root, 'origin', true).trim();
  const identity = remote ? normalizeRemote(remote, root) : `local-git:${common}`;
  const conflicts = [...new Set(localGit(root, 'conflicts').split('\0').filter(Boolean)
    .map(record => record.slice(record.indexOf('\t') + 1)))].sort();
  return {
    root, common, identity, head: localGit(root, 'head', true).trim() || null,
    branch: localGit(root, 'branch', true).trim() || null, conflicts,
  };
}
