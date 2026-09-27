import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Grove } from './store.ts';
import { hash, inspect } from './git.ts';

const maxSize = 4 * 1024 * 1024;
const maxEntries = 1000;
type Memory = { statement: string; evidencePath: string; evidenceHash: string };
const isObject = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: any, keys: string[]) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validPath = (path: any) => typeof path === 'string' && path.length > 0 && path.length <= 4096 && !/[\\\x00-\x1f:]/.test(path) && !path.split('/').some((part: string) => !part || part === '.' || part === '..');
const hex = (value: any) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function readBundle(input: string) {
  const fd = openSync(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxSize) throw new Error('Memory bundle must be a regular file no larger than 4 MiB');
    const buffer = Buffer.alloc(maxSize + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > maxSize) throw new Error('Memory bundle exceeds 4 MiB');
    bytes = buffer.subarray(0, length);
  } finally { closeSync(fd); }
  let bundle: any;
  try { bundle = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Memory bundle must be valid JSON'); }
  if (!exactKeys(bundle, ['format', 'version', 'repositoryKey', 'memories']) || bundle.format !== 'grove-memory' || bundle.version !== 1 || !hex(bundle.repositoryKey) || !Array.isArray(bundle.memories) || bundle.memories.length > maxEntries) throw new Error('Unsupported or invalid memory bundle');
  for (const item of bundle.memories) {
    if (!exactKeys(item, ['statement', 'evidencePath', 'evidenceHash']) || typeof item.statement !== 'string' || !item.statement.trim() || item.statement.length > 4000 || !validPath(item.evidencePath) || !hex(item.evidenceHash)) throw new Error('Invalid memory entry; nothing imported');
  }
  return { bundle: bundle as { repositoryKey: string; memories: Memory[] }, digest: hash(bytes) };
}

export function exportMemories(store: Grove, checkoutId: string, output: string) {
  const checkout = store.checkout(checkoutId);
  const eligible = store.memories(checkoutId).filter(memory => memory.state === 'reviewed' && memory.freshness === 'matching');
  if (eligible.length > maxEntries) throw new Error('Export exceeds the 1000-memory bundle limit');
  const memories = eligible.map(memory => ({ statement: memory.statement, evidencePath: memory.evidence_path, evidenceHash: memory.evidence_hash }));
  const serialized = JSON.stringify({ format: 'grove-memory', version: 1, repositoryKey: hash(checkout.identity), memories }, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > maxSize) throw new Error('Export exceeds 4 MiB');
  const destination = resolve(output);
  const parent = realpathSync(dirname(destination));
  const temporary = join(parent, `.grove-transfer-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
    linkSync(temporary, destination); // Publish only the complete file, never overwrite.
  } finally { try { unlinkSync(temporary); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  return { file: destination, exported: memories.length, sha256: hash(serialized), note: 'Transfer manually. Contains user-entered memory and relative evidence paths; inspect before sharing. This is not encrypted or authenticated.' };
}

export function importMemories(store: Grove, checkoutId: string, input: string, dryRun = false) {
  const { bundle, digest } = readBundle(input);
  const checkout = store.checkout(checkoutId);
  const current = inspect(checkout.path);
  if (current.identity !== checkout.identity || current.root !== checkout.path || current.common !== checkout.common || current.conflicts.length) throw new Error('Checkout identity changed or has conflicts; resolve before importing');
  if (bundle.repositoryKey !== hash(checkout.identity)) throw new Error('Bundle belongs to a different repository identity');
  const apply = () => {
    let duplicate = 0;
    const pending: { memoryId: string; statement: string; evidencePath: string; sameEvidenceOtherStatements: number }[] = [];
    const seen = new Set<string>();
    for (const memory of bundle.memories) {
      const key = hash(JSON.stringify([memory.statement.trim(), memory.evidencePath, memory.evidenceHash]));
      const exists = store.db.prepare('SELECT id FROM memories WHERE repository_id=? AND statement=? AND evidence_path=? AND evidence_hash=?').get(checkout.repository_id, memory.statement.trim(), memory.evidencePath, memory.evidenceHash);
      if (exists || seen.has(key)) { duplicate++; continue; }
      seen.add(key);
      const related = store.db.prepare('SELECT count(*) AS n FROM memories WHERE repository_id=? AND evidence_path=? AND evidence_hash=? AND statement<>?').get(checkout.repository_id, memory.evidencePath, memory.evidenceHash, memory.statement.trim()) as any;
      const memoryId = dryRun ? `preview:${key}` : randomUUID();
      pending.push({ memoryId, statement: memory.statement.trim(), evidencePath: memory.evidencePath, sameEvidenceOtherStatements: related.n });
      if (!dryRun) {
        const now = new Date().toISOString();
        store.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?)').run(memoryId, checkout.repository_id, memory.statement.trim(), 'candidate', memory.evidencePath, memory.evidenceHash, now);
        store.db.prepare('INSERT INTO memory_imports VALUES(?,?,?)').run(memoryId, digest, now);
      }
    }
    return { dryRun, imported: dryRun ? 0 : pending.length, wouldImport: pending.length, duplicate, candidates: pending,
      note: 'Imported statements are untrusted candidates. Review their meaning and current source, then run grove review with --confirm. Same evidence can support different statements; Grove does not infer semantic contradictions.' };
  };
  return dryRun ? apply() : store.transaction(apply);
}

export function reviewMemory(store: Grove, checkoutId: string, memoryId: string) {
  const indexed = store.index(checkoutId);
  const checkout = store.checkout(checkoutId);
  return store.transaction(() => {
    const memory = store.db.prepare('SELECT * FROM memories WHERE id=? AND repository_id=?').get(memoryId, checkout.repository_id) as any;
    if (!memory) throw new Error('Unknown memory for this repository');
    const file = store.db.prepare('SELECT content_hash FROM files WHERE snapshot_id=? AND path=?').get(indexed.snapshotId, memory.evidence_path) as any;
    if (!memory.evidence_hash || file?.content_hash !== memory.evidence_hash) throw new Error('Evidence is absent or stale; review the changed source and record a new memory');
    store.db.prepare("UPDATE memories SET state='reviewed' WHERE id=?").run(memoryId);
    return { memoryId, state: 'reviewed', note: 'Human review was confirmed; matching bytes do not establish semantic truth.' };
  });
}
