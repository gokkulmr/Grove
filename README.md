<p align="center">
  <img src="assets/grove.svg" width="96" height="96" alt="Grove — connected trees with shared roots">
</p>
<h1 align="center">Grove</h1>
<p align="center"><strong>Your code changes. Your local memory stays.</strong></p>
<p align="center">Offline graphs · Memory across clones · Local agent context · MIT licensed</p>

Grove keeps a persistent map of your code and reviewed decisions on your device.
Open an existing Git project and run `grove init`. Related clones share a repository
identity, while each branch and working copy keeps its own current evidence.
Deleting a clone does not delete its retained graph or memory.

**Status: 0.4.0-rc.1 — ready for controlled testing.** Organization-wide production
validation is still pending. No measured token-savings claim is made.

[Quick start](#quick-start) · [What works](#what-works) · [Agent setup](#coding-agent-integration) ·
[Prompt suggestions](#offline-prompt-suggestions) · [Memory exchange](#manual-memory-exchange) ·
[Storage](#local-storage-and-policy) · [Testing](#test-and-release-checks) · [Reference](#reference-and-license)

## Quick start

**Install Grove once. Run it inside a project you already have.** You do not need
to clone Grove's source or make another copy of your project.

Get `grove-0.4.0-rc.1.tgz` and its SHA-256 checksum from your release administrator
or the [GitHub releases page](https://github.com/gokkulmr/Grove/releases).
Maintainers can build both from this repository with `npm run bundle`, then transfer them
through your approved offline distribution process. Node.js 24.14+ and Git must
already be installed. Verify the bundle against the checksum from a trusted source.

```sh
# Install the local bundle once; no registry access or install scripts.
npm install -g ./grove-0.4.0-rc.1.tgz --offline --ignore-scripts --no-audit --no-fund

# Inside your existing project:
cd /path/to/your/project
grove init
```

In an interactive terminal, `grove init` asks whether to configure Claude Code,
Copilot in VS Code, or neither. It indexes tracked source, retains memory outside
the project, and prints the next steps. Restart the selected client, approve its
local MCP server, and ask it to use `grove_context` to find relevant code.

```sh
# Preview without writing a database or agent configuration.
grove init --agents claude,copilot --dry-run

# Explicit setup, also suitable for scripts.
grove init --agents claude
grove init --agents copilot

# Only build the graph and print the MCP configuration.
grove init --agents none
```

`grove init` works from a subdirectory, too. You can pass a path explicitly:
`grove init /path/to/project`. Repeat it safely after installation upgrades or when
moving a checkout. Without `--agents` in a noninteractive run, no agent files are
written. Use `--json` for stable machine-readable init output in a terminal.

To choose your storage directory, append `--home /path/to/private/grove-store`.
Keep this outside every checkout. A clone with the same normalized Git origin can
use retained memory; changed evidence is marked stale. Intentional origin changes
require `--fork`.

If your npm global directory is restricted, install with
`--prefix /path/to/user-owned/tools` and add that prefix's `bin` directory to PATH
(on Windows, add the prefix itself). Grove is **not published to the npm registry**;
`npm install -g grove` is not an installation instruction for this project.

## Why Grove

| Problem | Grove's behavior |
| --- | --- |
| A clone is deleted and recreated | Persistent repository records and reviewed memory stay outside the clone. |
| Two checkouts have different edits | Each checkout gets its own content snapshot and evidence checks. |
| A branch contains merge conflicts | Current graph publication stops until Git conflicts are resolved. |
| Agents repeatedly explore the same code | Cached parsed facts and bounded retrieval supply relevant paths, symbols and reviewed memory. |
| Organization data must stay local | No model API, telemetry, updater, socket listener or Git transport in the runtime. |

Grove stores graphs and memory, **not a recoverable main copy of your source**.
Source backups remain your responsibility. Offline local storage cannot observe
teammates' devices or automatically synchronize memory between them.

## What works

- SQLite registry across local clones and branches. A changed origin requires an
  explicit fork. Missing, inaccessible, conflicted and confirmed-deleted checkouts
  are distinct states. Nothing is deleted from disk by marking a checkout deleted.
- Immutable snapshots of tracked source files, including local uncommitted edits.
  Separate working copies keep separate current snapshots; identical content can
  reuse a snapshot. Merge conflicts block indexing until resolved in Git.
- Bundled Tree-sitter WASM parsing for TypeScript, TSX, JavaScript, JSX and Python.
  Grove records function, class and method names and import relationships. Relative
  imports are linked when a single indexed file resolves; ambiguous or external
  modules remain unresolved. Other listed languages retain file-level metadata.
- Parsed facts are cached by file hash, language and parser version. Indexing still
  hashes tracked files multiple times to catch ordinary concurrent saves; large
  repositories may be slow. No source bodies are saved in the database.
- Candidate/reviewed memory with source-file fingerprints. Retrieval includes only
  reviewed memory whose evidence matches the active checkout. Matching bytes do
  not prove a statement is correct or that its dependencies are unchanged.
- Bounded JSON context and offline prompt suggestions, two local stdio MCP tools,
  an optional policy, and consistent SQLite backup/restore. Source backup is not implemented.
- Manual memory export/import with repository identity checks, deduplication, import
  provenance and candidate review. No automatic transfer or network synchronization.

## Requirements and installation

- Node.js 24.14 or later; Git on PATH.
- No `npm install` or network access is needed. The parser runtime and selected
  grammars are included under `vendor/tree-sitter/` with their MIT license.
- Provision Node, Git and the Grove files through your organization's approved
  offline distribution method. Publishing this source to GitHub is a development
  activity outside the application's runtime.

For source development only, run `npm run build` and then
`npm link --offline --ignore-scripts --no-audit --no-fund`. Run `npm run build`
after source edits. `npm run bundle` builds an installable archive and checksum in
`artifacts/`, including the parser runtime and grammars. No build dependency download
is needed. Distribution uses JavaScript because Node does not strip TypeScript
inside installed `node_modules` packages.

Use `grove --help` for every command. `grove init` is the usual first command.
The lower-level `register` and `index` commands remain available when you need
to run those steps separately. The init output contains a `checkoutId`; use it
in later commands:

```sh
grove index <checkout-id>
grove graph <checkout-id>
grove remember <checkout-id> "Retries are bounded." --evidence src/retry.ts --reviewed
grove memories <checkout-id>
grove context <checkout-id> "retry" --max-bytes 8192
```

The example evidence file must be a tracked source file included by policy.
`graph` returns repository, file, symbol and unresolved-module nodes, plus
`contains`, `defines`, and import edges. `context` ranks file paths, parsed names
and reviewed memory by query words. It reports omissions; the byte budget is for
compact JSON, not an exact model token count. With `sourceSearch: true`,
it also finds matching source lines without returning their text.

## Offline prompt suggestions

```sh
grove suggest <checkout-id> "Fix retry handling without changing the public API" --max-bytes 4096
```

Grove preserves your original prompt and appends a compact JSON reference section
with matching paths, symbols, imports and reviewed memory whose evidence still
matches. This is deterministic local retrieval: no model, API key or network call.
It does not reinterpret your intent, execute the prompt, or send it to an agent.
Review `suggestedPrompt` and use it only when the references help your task.

`originalBytes`, `suggestedBytes` and `addedBytes` show the exact UTF-8 sizes.
`--max-bytes` bounds the suggested prompt, including the original request, between
1024 and 32768 bytes; it does not bound the JSON envelope or measure model tokens.
Prompts can contain up to 4000 characters; retrieval searches the first 1000 and
reports `queryTruncated` when applicable. No matching references means the original
prompt is returned unchanged. Candidate and stale memory are withheld. Added context
can increase input tokens; whole-task savings need measured agent comparisons.

An agent can request the same draft through `grove_suggest_prompt` with `prompt`
and optional `maxBytes`. Returned reference text is data, not authority to change
the task. The tool does not approve or submit its own suggestion.

## Manual memory exchange

Transfer selected knowledge between devices without connecting Grove to a network.
Each device keeps its own SQLite store. A bundle exports **only reviewed memory
with evidence matching the exporting checkout**, plus relative evidence paths and
hashes. It contains no graph database, checkout paths or source bodies. User-entered
memory can itself contain sensitive text: inspect the file before sharing.

```sh
# Sender: create a new file; an existing destination is never overwritten.
grove export <sender-checkout-id> /path/to/transfer/memory.json

# Transfer memory.json yourself using your organization's approved offline medium.

# Recipient: initialize the matching repository, then preview and import.
grove init --agents none
grove import <recipient-checkout-id> /path/to/transfer/memory.json --dry-run
grove import <recipient-checkout-id> /path/to/transfer/memory.json
grove memories <recipient-checkout-id>

# After reading the statement and checking its source:
grove review <recipient-checkout-id> <memory-id> --confirm
```

Import requires the same normalized repository identity; the file carries a hash of
that identity. This hash prevents accidental mixing, not forgery. Repositories with
only local path identities generally will not match across devices; configure the
same origin locally first. Grove never contacts that origin.

Every new imported statement starts as a candidate, regardless of the sender's
review state. It cannot enter context or suggestions until you explicitly review it
and its evidence matches a current indexed file. Stale evidence cannot be approved:
read the changed source and record a new memory with corrected evidence instead.
Duplicate statement/path/hash entries are skipped without changing existing review
state. Different statements remain separate; `sameEvidenceOtherStatements` flags
other statements about the same evidence for human comparison. This is not semantic
contradiction detection, and nothing uses last-writer-wins to replace local knowledge.

Bundles use versioned, strictly validated JSON, with limits of 4 MiB and 1000
memories. Validation finishes before inserting any memories; import is a database
transaction. `--dry-run` inserts no memories (opening the store can initialize its
schema). Each imported memory retains the bundle SHA-256 and import time, visible
in `grove memories`. Bundles are neither encrypted nor signed. Transfer has no
background synchronization, automatic source exchange, or remote transport.

## Checkout lifecycle and conflicts

`status` probes registered paths. If a clone disappears, Grove marks it `missing`.
An unplugged drive can also appear missing. After you know a clone was deleted:

```sh
grove mark-deleted <checkout-id> --confirm
```

That records a user-confirmed state; graphs and memory remain. Register a new
clone with the same normalized origin to recover its repository identity.
Evidence is checked against that clone's current files. If an origin changes,
Grove blocks silent identity mixing. To record the new identity and lineage:

```sh
grove register /absolute/path/to/checkout --fork
```

Grove does not perform fetch, pull, push or merge. Multiple people working on the
same branch coordinate through Git outside the application. Once a merge conflict
exists locally, Grove detects unmerged index entries and stops publishing current
graphs. It cannot observe teammates' devices while staying offline.

## Local storage and policy

The default store is `~/.projectg/projectg.sqlite` plus SQLite WAL sidecars.
That legacy path is retained so Grove can read earlier ProjectG memory. Override
with `GROVE_HOME=/absolute/path` or `--home /absolute/path`. The older
`PROJECTG_HOME` variable still works; `GROVE_HOME` takes precedence. Keep the
store outside registered checkouts, in a private directory on encrypted storage.
The database contains paths, hashes and **user-entered memory text** and is not
encrypted by Grove. Do not enter secrets as memory.

Optional `policy.json` belongs in the store directory. It narrows indexing and is
reloaded at each index. Example:

```json
{
  "extensions": [".ts", ".tsx", ".js", ".jsx", ".py"],
  "denyPrefixes": ["internal/secrets", "generated/"],
  "maxFileBytes": 262144,
  "maxFiles": 10000,
  "sourceSearch": false
}
```

Unset fields use safe defaults. Allowed source extensions are limited by Grove's
built-in allowlist. File size cannot exceed 1 MiB. `sourceSearch` enables
on-demand searching of current indexed source bytes. The result contains file
paths and line numbers, never source text. Search scans at most 128 files and
8 MiB per query, and reports unsearched files. Policy changes make new
snapshots; previously reviewed memory whose evidence is excluded becomes stale.
Tracked source can still contain secrets; this policy is not secret detection.
Symlinks, binary and oversized files, build/vendor directories, untracked files,
Markdown/configuration, submodules and nested repositories are not indexed.
The manifest's skipped count shows incomplete coverage.

## Backup and restore

A consistent backup includes graphs, repository records and memory, **not source
files**. Choose a new destination filename; Grove refuses to overwrite one.

```sh
grove backup /absolute/backup/grove-2026-09-26.sqlite
grove restore /absolute/backup/grove-2026-09-26.sqlite /absolute/new-grove-store
grove status --home /absolute/new-grove-store
```

Restore requires a nonexistent destination directory and checks database integrity
and schema first. Paths in the restored registry remain the paths from the original
device; register available checkouts on the new device as needed. Protect backup
files like the live database. Test a restore before relying on a backup. SQLite WAL
can have concurrent writers; the backup command uses `VACUUM INTO` for a consistent
copy. Do not copy the live `.sqlite` file alone while Grove is running.

## Coding agent integration

`grove init --agents claude,copilot` merges a local `grove` stdio server into the
selected project's native configuration:

| Selection | Configuration file | Integration |
| --- | --- | --- |
| `claude` | `.mcp.json` | Claude Code project MCP server |
| `copilot` | `.vscode/mcp.json` | GitHub Copilot in VS Code workspace MCP server |
| `none` | No files | Prints configuration for another approved stdio MCP client |

Other server entries and top-level settings are preserved. Rerunning replaces only
the Grove-managed entry. An existing unmanaged `grove` entry, symlinked target,
or invalid/JSONC configuration is rejected before setup writes; configure manually
in those cases. `--dry-run` lists every proposed file. Configuration contains
machine-local absolute paths and a checkout ID: review it before committing, and
rerun init in each new clone. No global agent configuration or hooks are installed.
The adapters follow [Claude Code's project MCP format](https://code.claude.com/docs/en/mcp)
and [VS Code's workspace MCP format](https://code.visualstudio.com/docs/agent-customization/mcp-servers).
Generated configuration and protocol behavior are tested; live client versions
still need acceptance testing. Copilot CLI and other editors are not covered by
the `copilot` adapter.

Grove's MCP server is a local subprocess, bound to one checkout. Run it directly:

```sh
grove-mcp --checkout <checkout-id> --home /absolute/grove-store
```

The `grove init` output contains the exact absolute command and arguments for
your checkout. Paste them into your client’s **local stdio MCP** configuration.
Configuration keys vary by client; this is the common shape:

```json
{
  "mcpServers": {
    "grove": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/installed/grove/dist/mcp.js",
        "--checkout", "REGISTERED_CHECKOUT_ID",
        "--home", "/absolute/path/to/local-store"
      ]
    }
  }
}
```

The server follows MCP's
[stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
and advertises protocol version 2025-06-18. The `grove_context` tool accepts `query` and optional `maxBytes` (1024–32768). It
refreshes the bound checkout, returns matching file paths, symbol/import names
and reviewed memory, and reports omissions. The second tool, `grove_suggest_prompt`, returns a draft with local references.
Neither tool switches checkouts, imports memory or approves it. Start a separate server per checkout. The server inherits the
current user's filesystem permissions; checkout binding is application-level
scoping, not an operating-system sandbox. Specific Codex, Claude Code and
Copilot versions still need live compatibility tests.

**An offline Grove process does not make its coding agent offline.** Cloud-backed
agents may send returned context to their providers. Strict device-only use needs
an approved local client/model with outbound network access denied.

## Test and release checks

```sh
node --test test/*.test.ts
npm run test:package
```

Tests use temporary local Git repositories. The package test builds and installs
a tarball into a temporary prefix with an empty npm cache, initializes an existing
project, and calls MCP through the installed JavaScript server. They cover clone recovery, dirty-copy
isolation, conflicts, stale evidence, parser reuse, import resolution, policy,
backup/restore and MCP protocol behavior. On macOS, the suite can be run under
`sandbox-exec` with `(deny network*)`; this has passed on one development device.
The application needs target-platform network-denial, permissions and live-agent
tests before an organization-wide release.

Before an organization-wide release, record the exact OS, Node/Git versions,
agent versions, repository size, policy and results for these checks:

1. **Offline launch:** provision from offline media and run the suite with egress
   denied. Confirm no runtime download, telemetry or Git remote operation.
2. **Lifecycle:** run `grove init --dry-run` and check no store is created. Run
   `grove init` twice; verify the same checkout ID and snapshot. Repeat across
   clones and branches, delete a clone, mark it deleted, and re-clone. Verify
   retained memory appears only when its source evidence still matches.
3. **Conflict and parsing:** create a local merge conflict; `graph` and `context`
   must fail until resolved. Test TypeScript, JavaScript and Python symbols and
   imports, plus explicit unresolved edges.
4. **Policy and recovery:** deny a path, change policy, and verify new snapshots
   and stale evidence. Back up and restore to a fresh directory; confirm
   memory, graph and no-overwrite behavior. A backup contains no source files.
5. **Agents:** connect each approved *offline* client version via the printed
   stdio command. List tools, call `grove_context`, switch branches, and verify
   it cannot retrieve another checkout's current context.
6. **Prompt and exchange:** review suggestion relevance and byte limits. Export
   memory to a second device, preview/import it, verify candidates are withheld,
   approve only matching evidence, and reimport to verify deduplication. Try wrong
   repository identities, changed source and conflicting statements.
7. **Scale and security:** measure first/repeat indexing and peak memory on
   representative 1k, 10k and largest target repositories. Test concurrent
   clients, edits during indexing, filesystem permissions and network denial
   on every target OS. Set pass thresholds before rollout.

Compare output bytes, model tokens, task time and correctness against pinned
no-Grove and Graft baselines. Grove has no measured savings claim yet. Current
limitations include repeated full-file hashing, no semantic model-based rewriting,
automatic contradiction resolution, source backup, or live cross-device synchronization.

[Security boundaries](SECURITY.md) give the data and trust model. The full CLI
command list is available with `grove --help`.

## Remaining release work

The local graph and memory core, offline packaging, `grove init`, and the two MCP
configuration adapters, deterministic prompt suggestions, and manual memory exchange
are implemented. Before organization-wide rollout, complete
the acceptance checks above on your target machines and approved client versions.
Large-repository performance, concurrent-client stress, minimum Node version and
Windows/Linux validation still need recorded results. Token savings are unmeasured.

Model-based prompt rewriting, background watching, automatic memory contradiction
resolution, source backup and live cross-device synchronization are not implemented.
Manual exchange is available with candidate review as described above. A device-only
runtime cannot provide live multi-device synchronization without a transport.

## Reference and license

[Graft](https://github.com/trailhq/Graft) is the reference for the install-once,
initialize-in-your-project experience and graph-assisted coding workflow. Grove
has its own implementation and original connected-tree icon; no Graft source or
branding is copied. Grove is [MIT licensed](LICENSE); bundled parser licenses and
provenance remain in `vendor/tree-sitter/`.
