#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Grove } from './store.ts';
import { context } from './context.ts';
import { backup, restoreBackup } from './backup.ts';
import { groveInit } from './init.ts';
import { createInterface } from 'node:readline/promises';
import { suggestPrompt } from './suggest.ts';
import { exportMemories, importMemories, reviewMemory } from './exchange.ts';

const help = `Grove 0.4.0-rc.1 — offline repository graphs and memory

Usage: grove <command> [arguments]

  init [directory] [--dry-run] [--fork] [--agents claude,copilot|none]
                                    Register + index; optionally configure local agents
  register <directory> [--fork]       Register a clone; --fork accepts changed origin as a new identity
  status                            Refresh availability and list repositories/checkouts
  index <checkout-id>                Publish/reuse a tracked-source file snapshot
  graph <checkout-id>                Refresh and return the file-level graph
  mark-deleted <checkout-id> --confirm
                                    Record user-confirmed deletion; deletes no files or memory
  remember <checkout-id> <statement> [--evidence <relative-file>] [--reviewed]
  memories <checkout-id>             List memory with current source-fingerprint status
  suggest <checkout-id> <prompt>     Draft a prompt with bounded local reference data
  export <checkout-id> <new-file>    Export matching reviewed memory for manual transfer
  import <checkout-id> <file> [--dry-run]
                                    Import same-repository memory as candidates
  review <checkout-id> <memory-id> --confirm
                                    Confirm human review of matching source evidence
  backup <new-sqlite-file>           Make a consistent, owner-only store backup
  restore <sqlite-file> <new-home>   Restore into a new local store directory
  context <checkout-id> <query> [--max-bytes <1024..32768>]
                                    Search paths and matching reviewed memory (compact JSON)

Options: --home <directory>          Local store (GROVE_HOME; legacy PROJECTG_HOME or ~/.projectg)
         --help                     Show this help
         --json                     Print machine-readable init output in a terminal

No network, model calls, updates, telemetry, or Git transports.
Bundled parsers cover TypeScript, JavaScript and Python; other languages have file-level graphs.
Automatic watching, source backups and live team sync are not implemented.
Local MCP entrypoint: grove-mcp --checkout <checkout-id> [--home <directory>]
`;

let store: Grove | undefined;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    home: { type: 'string' }, help: { type: 'boolean' }, fork: { type: 'boolean' },
    confirm: { type: 'boolean' }, evidence: { type: 'string' }, reviewed: { type: 'boolean' },
    'max-bytes': { type: 'string' }, 'dry-run': { type: 'boolean' },
    agents: { type: 'string' }, json: { type: 'boolean' },
  } });
  const [command, ...args] = positionals;
  if (values.help || !command) process.stdout.write(help);
  else {
    const arities: Record<string, number> = { init: -1, backup: 1, restore: 2, register: 1, status: 0, index: 1, graph: 1, 'mark-deleted': 1, remember: 2, memories: 1, context: 2, suggest: 2, export: 2, import: 2, review: 2 };
    if (!Object.hasOwn(arities, command) || (command === 'init' ? args.length > 1 : args.length !== arities[command])) throw new Error('Invalid command or arguments. Run with --help.');
    if (values['dry-run'] && !['init', 'import'].includes(command)) throw new Error('--dry-run is only supported for init and import');
    if (values.agents !== undefined && command !== 'init') throw new Error('--agents is only supported for init');
    if (command === 'mark-deleted' && !values.confirm) throw new Error('Use --confirm only after confirming this checkout was deleted');
    if (command === 'review' && !values.confirm) throw new Error('Use --confirm after reviewing the memory statement and its source evidence');
    if (command !== 'restore' && command !== 'init') store = new Grove(values.home);
    let result: unknown = command === 'restore' ? restoreBackup(args[0], args[1]) : undefined;
    switch (command) {
      case 'init': {
        let agents = values.agents;
        if (agents === undefined && process.stdin.isTTY && process.stdout.isTTY && !values.json) {
          const prompt = createInterface({ input: process.stdin, output: process.stderr });
          try { agents = await prompt.question('Configure agents (claude, copilot, or none) [none]: '); }
          finally { prompt.close(); }
        }
        result = groveInit(args[0], { home: values.home, dryRun: values['dry-run'], fork: values.fork, agents });
        break;
      }
      case 'backup': result = backup(store!, args[0]); break;
      case 'restore': break;
      case 'register': result = store!.register(args[0], values.fork); break;
      case 'status': result = store!.list(); break;
      case 'index': result = store!.index(args[0]); break;
      case 'graph': result = store!.graph(args[0]); break;
      case 'mark-deleted': result = store!.markDeleted(args[0]); break;
      case 'remember': result = store!.remember(args[0], args[1], values.evidence, values.reviewed); break;
      case 'memories': result = store!.memories(args[0]); break;
      case 'suggest': result = suggestPrompt(store!, args[0], args[1], values['max-bytes'] === undefined ? undefined : Number(values['max-bytes'])); break;
      case 'export': result = exportMemories(store!, args[0], args[1]); break;
      case 'import': result = importMemories(store!, args[0], args[1], values['dry-run']); break;
      case 'review': result = reviewMemory(store!, args[0], args[1]); break;
      case 'context': result = context(store, args[0], args[1], values['max-bytes'] === undefined ? undefined : Number(values['max-bytes'])); break;
    }
    if (command === 'init' && process.stdout.isTTY && !values.json) {
      const value = result as any;
      process.stdout.write(`\nGrove ${value.dryRun ? 'preview' : 'ready'}\n\nProject: ${value.checkoutPath}\nStore: ${value.store}\nSource files: ${value.trackedSourceFiles}\n`);
      if (value.dryRun) process.stdout.write(`${value.actions.join('\n')}\n\n${value.note}\n`);
      else process.stdout.write(`Checkout: ${value.checkoutId}\n${value.configuredAgents.map((item: any) => `${item.agent}: ${item.path}`).join('\n')}\n${value.next}\n\nMCP configuration:\n${JSON.stringify(value.mcp, null, 2)}\n`);
    } else process.stdout.write(`${JSON.stringify(result, null, command === 'context' ? undefined : 2)}\n`);
  }
} catch (error: any) {
  process.stderr.write(`Grove: ${error.message}\n`);
  process.exitCode = 1;
} finally { store?.close(); }
