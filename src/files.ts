import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { hash, localGit } from './git.ts';

export const GRAPH_VERSION = 'files-v1';
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.cs', '.rb', '.swift', '.php']);
const excluded = new Set(['.git', '.projectg', 'node_modules', 'vendor', 'dist', 'build']);
export type FileFact = { path: string; hash: string; bytes: number; lines: number };

export function readSafe(root: string, path: string): Buffer {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Evidence path must be inside the checkout');
  }
  // Reject symlinks at every component, including symlinked directories.
  let cursor = root;
  for (const part of rel.split(/[\\/]/)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symlinks are excluded');
  }
  const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Only regular files up to 1 MiB are supported');
    const bytes = readFileSync(fd);
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error('Binary or oversized file excluded');
    return bytes;
  } finally { closeSync(fd); }
}

export function manifest(root: string): { files: FileFact[]; skipped: string[] } {
  const paths = [...new Set(localGit(root, 'files').split('\0').filter(Boolean))].sort();
  const files: FileFact[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    if (!extensions.has(extname(path).toLowerCase()) || path.split('/').some(p => excluded.has(p))) {
      skipped.push(path); continue;
    }
    try {
      const bytes = readSafe(root, path);
      files.push({ path, hash: hash(bytes), bytes: bytes.length,
        lines: bytes.length ? bytes.toString('utf8').split('\n').length : 0 });
    } catch (error: any) {
      // An unstaged deletion is valid state. Unsupported files are explicitly
      // excluded; permission/I/O failures abort instead of publishing an incomplete graph.
      if (error.code === 'ENOENT' || /Symlinks|excluded|Only regular/.test(error.message)) skipped.push(path);
      else throw error;
    }
  }
  return { files, skipped };
}
