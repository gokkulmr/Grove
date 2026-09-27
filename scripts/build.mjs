import { stripTypeScriptTypes } from 'node:module';
import { readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(join(root, 'src')).filter(name => name.endsWith('.ts'))) {
  const source = readFileSync(join(root, 'src', name), 'utf8');
  // All runtime imports are local static imports. Leave source extension lists intact.
  const javascript = stripTypeScriptTypes(source).replace(/(from\s+['"]\.\/[^'"\n]+)\.ts(['"])/g, '$1.js$2');
  const target = join(out, name.replace(/\.ts$/, '.js'));
  writeFileSync(target, javascript);
  if (['cli.ts', 'mcp.ts'].includes(name)) chmodSync(target, 0o755);
}
console.log('Built Grove locally; no dependencies downloaded.');
