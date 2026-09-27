import './build.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'artifacts');
mkdirSync(destination, { recursive: true });
// npm_execpath works across platforms when invoked via npm run bundle.
const npm = process.env.npm_execpath;
const args = ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', destination];
const output = npm ? execFileSync(process.execPath, [npm, ...args], { cwd: root, encoding: 'utf8' })
  : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, encoding: 'utf8' });
const [pack] = JSON.parse(output);
const file = join(destination, pack.filename);
const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(`${file}.sha256`, `${digest}  ${pack.filename}\n`);
console.log(`Bundle: ${file}\nSHA-256: ${digest}`);
