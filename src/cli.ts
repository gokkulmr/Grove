#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Grove } from './store.ts';
import { context } from './context.ts';

const help = `Grove 0.2 — offline local repository registry and file graph

Usage: node src/cli.ts <command> [arguments]

  register <directory> [--fork]       Register a clone; --fork accepts changed origin as a new identity
  status                            Refresh availability and list repositories/checkouts
  index <checkout-id>                Publish/reuse a tracked-source file snapshot
  graph <checkout-id>                Refresh and return the file-level graph
  mark-deleted <checkout-id> --confirm
                                    Record user-confirmed deletion; deletes no files or memory
  remember <checkout-id> <statement> [--evidence <relative-file>] [--reviewed]
  memories <checkout-id>             List memory with current source-fingerprint status
  context <checkout-id> <query> [--max-bytes <1024..32768>]
                                    Search paths and matching reviewed memory (compact JSON)

Options: --home <directory>          Local store (GROVE_HOME; legacy PROJECTG_HOME or ~/.projectg)
         --help                     Show this help

No network, model calls, updates, telemetry, or Git transports. File graph only:
symbol parsing, automatic watching, source backups and team sync are not implemented.
Local MCP entrypoint: node src/mcp.ts --checkout <checkout-id> [--home <directory>]
`;

let store: Grove | undefined;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    home: { type: 'string' }, help: { type: 'boolean' }, fork: { type: 'boolean' },
    confirm: { type: 'boolean' }, evidence: { type: 'string' }, reviewed: { type: 'boolean' },
    'max-bytes': { type: 'string' },
  } });
  const [command, ...args] = positionals;
  if (values.help || !command) process.stdout.write(help);
  else {
    const arities: Record<string, number> = { register: 1, status: 0, index: 1, graph: 1, 'mark-deleted': 1, remember: 2, memories: 1, context: 2 };
    if (!Object.hasOwn(arities, command) || args.length !== arities[command]) throw new Error('Invalid command or arguments. Run with --help.');
    if (command === 'mark-deleted' && !values.confirm) throw new Error('Use --confirm only after confirming this checkout was deleted');
    store = new Grove(values.home);
    let result: unknown;
    switch (command) {
      case 'register': result = store.register(args[0], values.fork); break;
      case 'status': result = store.list(); break;
      case 'index': result = store.index(args[0]); break;
      case 'graph': result = store.graph(args[0]); break;
      case 'mark-deleted': result = store.markDeleted(args[0]); break;
      case 'remember': result = store.remember(args[0], args[1], values.evidence, values.reviewed); break;
      case 'memories': result = store.memories(args[0]); break;
      case 'context': result = context(store, args[0], args[1], values['max-bytes'] === undefined ? undefined : Number(values['max-bytes'])); break;
    }
    process.stdout.write(`${JSON.stringify(result, null, command === 'context' ? undefined : 2)}\n`);
  }
} catch (error: any) {
  process.stderr.write(`Grove: ${error.message}\n`);
  process.exitCode = 1;
} finally { store?.close(); }
