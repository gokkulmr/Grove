import { DatabaseSync } from 'node:sqlite';
import { chmodSync, constants, copyFileSync, existsSync, linkSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Grove } from './store.ts';

export function backup(store: Grove, output: string) {
  const destination = resolve(output);
  if (existsSync(destination)) throw new Error('Backup destination already exists');
  const parent = realpathSync(dirname(destination));
  const temporary = join(parent, `.grove-backup-${randomUUID()}.sqlite`);
  try {
    const check = store.db.prepare('PRAGMA integrity_check').get() as any;
    if (check.integrity_check !== 'ok') throw new Error('Store integrity check failed');
    store.db.prepare('VACUUM INTO ?').run(temporary);
    chmodSync(temporary, 0o600);
    linkSync(temporary, destination); // O_EXCL semantics: never overwrite a backup.
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { backup: destination };
}

export function restoreBackup(input: string, target: string) {
  const source = realpathSync(input);
  const destination = resolve(target);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as any;
    const version = db.prepare('PRAGMA user_version').get() as any;
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name));
    if (integrity.integrity_check !== 'ok' || version.user_version !== 1 ||
        !['repositories', 'checkouts', 'snapshots', 'files', 'memories', 'events'].every(x => tables.has(x))) {
      throw new Error('Backup integrity or schema check failed');
    }
  } finally { db.close(); }
  mkdirSync(destination, { mode: 0o700 }); // must be a new, empty directory
  const file = join(destination, 'projectg.sqlite');
  copyFileSync(source, file, constants.COPYFILE_EXCL);
  chmodSync(file, 0o600);
  return { restored: destination, database: file };
}
