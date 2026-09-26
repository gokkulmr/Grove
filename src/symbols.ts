import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafe } from './files.ts';
import type { Policy } from './policy.ts';

const require = createRequire(import.meta.url);
const { Parser, Language } = require('../vendor/tree-sitter/tree-sitter.cjs');
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'tree-sitter');
await Parser.init({ locateFile: (name: string) => join(directory, name) });
const grammars = new Map();
for (const name of ['typescript', 'tsx', 'javascript', 'python']) {
  grammars.set(name, await Language.load(join(directory, `tree-sitter-${name}.wasm`)));
}
export const PARSER_VERSION = 'vscode-tree-sitter-wasm-0.3.1/extractor-2';
const language = (path: string) => {
  const ext = extname(path).toLowerCase();
  return ext === '.ts' ? 'typescript' : ext === '.tsx' ? 'tsx' : ['.js', '.jsx', '.mjs', '.cjs'].includes(ext) ? 'javascript' : ext === '.py' ? 'python' : null;
};
export type SymbolFact = { kind: 'function' | 'class' | 'method'; name: string; line: number };
export type ImportFact = { module: string; line: number };
export type ParseFacts = { symbols: SymbolFact[]; imports: ImportFact[]; parseErrors: boolean; language: string };
export function supports(path: string) { return language(path) !== null; }
export function parseFile(root: string, path: string, policy: Policy): ParseFacts | null {
  const name = language(path);
  if (!name) return null;
  const parser = new Parser();
  parser.setLanguage(grammars.get(name));
  const source = readSafe(root, path, policy.maxFileBytes).toString('utf8');
  const tree = parser.parse(source);
  if (!tree) throw new Error('Parser failed');
  const symbols: SymbolFact[] = [];
  const imports: ImportFact[] = [];
  const visit = (node: any, inClass = false) => {
    const kind = node.type;
    let symbolKind: SymbolFact['kind'] | null = null;
    if (['function_declaration', 'function_definition', 'generator_function_declaration', 'generator_function_definition'].includes(kind)) symbolKind = inClass ? 'method' : 'function';
    if (['class_declaration', 'class_definition'].includes(kind)) symbolKind = 'class';
    if (kind === 'method_definition') symbolKind = 'method';
    if (symbolKind) {
      const identifier = node.childForFieldName('name');
      if (identifier?.text) symbols.push({ kind: symbolKind, name: identifier.text.slice(0, 256), line: node.startPosition.row + 1 });
    }
    if (['import_statement', 'import_from_statement'].includes(kind)) {
      const value = node.childForFieldName('source')?.text ??
        node.childForFieldName('module_name')?.text ??
        (name === 'python' && kind === 'import_statement' ? node.childForFieldName('name')?.text : undefined);
      if (value) imports.push({ module: value.replace(/^['\"]|['\"]$/g, '').slice(0, 512), line: node.startPosition.row + 1 });
    }
    for (const child of node.namedChildren) visit(child, inClass || ['class_definition', 'class_declaration'].includes(kind));
  };
  try { visit(tree.rootNode); return { language: name, symbols, imports, parseErrors: tree.rootNode.hasError }; }
  finally { tree.delete(); parser.delete(); }
}
