import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hash, inspect } from './git.ts';
import { GRAPH_VERSION, manifest } from './files.ts';

type Checkout = { id: string; repository_id: string; path: string; identity: string; status: string; snapshot_id: string | null; common: string };
const now = () => new Date().toISOString();

export class Grove {
  db: DatabaseSync;
  home: string;
  constructor(home = process.env.GROVE_HOME || process.env.PROJECTG_HOME || join(homedir(), '.projectg')) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.home = realpathSync(home);
    this.db = new DatabaseSync(join(this.home, 'projectg.sqlite'));
    chmodSync(join(this.home, 'projectg.sqlite'), 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as any;
    if (version.user_version > 1) { this.db.close(); throw new Error('Database is newer than this Grove version'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
        derived_from TEXT REFERENCES repositories(id)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
        head TEXT, engine TEXT NOT NULL, created_at TEXT NOT NULL, skipped_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        snapshot_id TEXT NOT NULL REFERENCES snapshots(id), path TEXT NOT NULL,
        content_hash TEXT NOT NULL, bytes INTEGER NOT NULL, lines INTEGER NOT NULL,
        PRIMARY KEY(snapshot_id,path)
      );
      CREATE TABLE IF NOT EXISTS checkouts (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
        path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL, common TEXT NOT NULL,
        status TEXT NOT NULL, branch TEXT, head TEXT,
        snapshot_id TEXT REFERENCES snapshots(id), conflicts_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
        statement TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('candidate','reviewed')),
        evidence_path TEXT, evidence_hash TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, checkout_id TEXT NOT NULL REFERENCES checkouts(id),
        kind TEXT NOT NULL, at TEXT NOT NULL
      );
      PRAGMA user_version=1;
    `);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(id: string, kind: string) {
    this.db.prepare('INSERT INTO events(checkout_id,kind,at) VALUES(?,?,?)').run(id, kind, now());
  }
  checkout(id: string): Checkout {
    const row = this.db.prepare('SELECT * FROM checkouts WHERE id=?').get(id) as Checkout | undefined;
    if (!row) throw new Error('Unknown checkout ID');
    return row;
  }
  register(path: string, fork = false) {
    const info = inspect(path);
    const storePath = relative(info.root, this.home);
    if (!storePath || (!isAbsolute(storePath) && storePath !== '..' && !storePath.startsWith(`..${sep}`))) {
      throw new Error('GROVE_HOME must be outside the registered checkout');
    }
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM checkouts WHERE path=?').get(info.root) as Checkout | undefined;
      if (existing && existing.identity !== info.identity && !fork) {
        throw new Error('Origin identity changed. Register with --fork to record a separate repository and lineage.');
      }
      let repository = this.db.prepare('SELECT * FROM repositories WHERE identity=?').get(info.identity) as any;
      if (!repository) {
        repository = { id: randomUUID(), identity: info.identity };
        this.db.prepare('INSERT INTO repositories VALUES(?,?,?,?)').run(repository.id, info.identity, now(),
          existing && existing.identity !== info.identity ? existing.repository_id : null);
      }
      const id = existing?.id ?? randomUUID();
      const changed = existing && existing.repository_id !== repository.id;
      this.db.prepare(`INSERT INTO checkouts(id,repository_id,path,identity,common,status,branch,head,snapshot_id,conflicts_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        repository_id=excluded.repository_id, identity=excluded.identity, common=excluded.common,
        status=excluded.status, branch=excluded.branch, head=excluded.head,
        snapshot_id=excluded.snapshot_id, conflicts_json=excluded.conflicts_json, updated_at=excluded.updated_at`)
        .run(id, repository.id, info.root, info.identity, info.common,
          info.conflicts.length ? 'conflicted' : 'available', info.branch, info.head,
          changed ? null : existing?.snapshot_id ?? null, JSON.stringify(info.conflicts), now());
      this.event(id, changed ? 'identity-forked' : 'registered');
      return this.checkout(id);
    });
  }
  refresh(id: string) {
    const checkout = this.checkout(id);
    let status = 'available';
    let info: ReturnType<typeof inspect> | undefined;
    try {
      if (!statSync(checkout.path).isDirectory()) status = 'inaccessible';
      else {
        info = inspect(checkout.path);
        if (info.root !== checkout.path || info.identity !== checkout.identity || info.common !== checkout.common) status = 'identity-changed';
        else if (info.conflicts.length) status = 'conflicted';
      }
    } catch (error: any) {
      status = error.code === 'ENOENT' ? (checkout.status === 'deleted' ? 'deleted' : 'missing') : 'inaccessible';
    }
    this.transaction(() => {
      this.db.prepare('UPDATE checkouts SET status=?,branch=?,head=?,conflicts_json=?,updated_at=? WHERE id=?')
        .run(status, info?.branch ?? null, info?.head ?? null, JSON.stringify(info?.conflicts ?? []), now(), id);
      if (status !== checkout.status) this.event(id, status);
    });
    return this.checkout(id);
  }
  markDeleted(id: string) {
    const checkout = this.refresh(id);
    if (!['missing', 'deleted'].includes(checkout.status)) throw new Error('Only a missing checkout can be explicitly marked deleted');
    this.transaction(() => {
      this.db.prepare('UPDATE checkouts SET status=?,updated_at=? WHERE id=?').run('deleted', now(), id);
      this.event(id, 'user-confirmed-deletion');
    });
    return this.checkout(id);
  }
  list() {
    const rows = this.db.prepare('SELECT id FROM checkouts ORDER BY path').all() as {id: string}[];
    for (const row of rows) this.refresh(row.id);
    return {
      repositories: this.db.prepare('SELECT * FROM repositories ORDER BY created_at').all(),
      checkouts: this.db.prepare('SELECT * FROM checkouts ORDER BY path').all(),
    };
  }
  requireAvailable(id: string) {
    const checkout = this.refresh(id);
    if (checkout.status !== 'available') throw new Error(`Checkout is ${checkout.status}; resolve it before indexing or retrieving current evidence`);
    return checkout;
  }
  index(id: string) {
    const checkout = this.requireAvailable(id);
    const start = inspect(checkout.path);
    if (start.root !== checkout.path || start.identity !== checkout.identity || start.common !== checkout.common || start.conflicts.length) {
      throw new Error('Checkout identity or conflict state changed before indexing; retry');
    }
    const first = manifest(checkout.path);
    // A second hash pass detects ordinary concurrent saves. This is not an OS
    // filesystem snapshot; mutations after the check are caught at the next query.
    const second = manifest(checkout.path);
    const end = inspect(checkout.path);
    if (JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(start) !== JSON.stringify(end)) {
      throw new Error('Checkout changed during indexing; retry');
    }
    const snapshotId = hash(JSON.stringify([checkout.repository_id, GRAPH_VERSION, end.head, second]));
    let reused = false;
    this.transaction(() => {
      reused = !!this.db.prepare('SELECT id FROM snapshots WHERE id=?').get(snapshotId);
      if (!reused) {
        this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?)')
          .run(snapshotId, checkout.repository_id, end.head, GRAPH_VERSION, now(), JSON.stringify(second.skipped));
        const insert = this.db.prepare('INSERT INTO files VALUES(?,?,?,?,?)');
        for (const file of second.files) insert.run(snapshotId, file.path, file.hash, file.bytes, file.lines);
      }
      this.db.prepare('UPDATE checkouts SET snapshot_id=?,updated_at=? WHERE id=?').run(snapshotId, now(), id);
      this.event(id, reused ? 'snapshot-reused' : 'snapshot-created');
    });
    return { snapshotId, reused, files: second.files.length, skipped: second.skipped };
  }
  graph(id: string) {
    const indexed = this.index(id);
    const checkout = this.checkout(id);
    const files = this.db.prepare('SELECT path,content_hash,bytes,lines FROM files WHERE snapshot_id=? ORDER BY path')
      .all(indexed.snapshotId) as any[];
    return { ...indexed, repositoryId: checkout.repository_id, level: 'file',
      nodes: [{ id: checkout.repository_id, kind: 'repository' }, ...files.map(f => ({ ...f, id: f.path, kind: 'file' }))],
      edges: files.map(f => ({ source: checkout.repository_id, target: f.path, relation: 'contains' })) };
  }
  remember(id: string, statement: string, evidence?: string, reviewed = false) {
    const checkout = this.requireAvailable(id);
    if (!statement.trim() || statement.length > 4000) throw new Error('Memory must contain 1–4000 characters');
    let evidencePath: string | null = null;
    let evidenceHash: string | null = null;
    if (evidence) {
      evidencePath = relative(checkout.path, resolve(checkout.path, evidence)).split('\\').join('/');
      const indexed = this.index(id);
      const fact = this.db.prepare('SELECT content_hash FROM files WHERE snapshot_id=? AND path=?')
        .get(indexed.snapshotId, evidencePath) as any;
      if (!fact) throw new Error('Evidence must be an indexed tracked source file');
      evidenceHash = fact.content_hash;
    }
    if (reviewed && !evidenceHash) throw new Error('Reviewed memory requires source evidence');
    const memoryId = randomUUID();
    this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?)')
      .run(memoryId, checkout.repository_id, statement.trim(), reviewed ? 'reviewed' : 'candidate', evidencePath, evidenceHash, now());
    return { memoryId, state: reviewed ? 'reviewed' : 'candidate' };
  }
  memories(id: string) {
    const checkout = this.requireAvailable(id);
    const indexed = this.index(id);
    const rows = this.db.prepare('SELECT * FROM memories WHERE repository_id=? ORDER BY created_at,id')
      .all(checkout.repository_id) as any[];
    return rows.map(memory => {
      const fact = memory.evidence_path ? this.db.prepare('SELECT content_hash FROM files WHERE snapshot_id=? AND path=?')
        .get(indexed.snapshotId, memory.evidence_path) as any : null;
      return { ...memory, freshness: !memory.evidence_hash ? 'unknown' : fact?.content_hash === memory.evidence_hash ? 'matching' : 'stale' };
    });
  }
}

// Preserve the original API name for existing local integrations.
export { Grove as ProjectG };
