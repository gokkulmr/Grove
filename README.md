# Grove

Grove is a local repository graph and memory store for coding agents. It joins
independent clones by normalized Git origin, keeps metadata when a clone is deleted,
and checks memory evidence against the checkout you are using. All application
operations use local files and fixed read-only Git commands. Grove has no updater,
telemetry, model API, socket listener, or Git remote transport.

**Status: 0.3 release candidate for controlled testing.** No organization-wide
production claim has been made. The required acceptance checks are listed below.
The project is MIT licensed. [Graft](https://github.com/trailhq/Graft) inspired the onboarding and graph design;
no Graft source is copied.

## Quick start

From the Grove source directory, make the optional local CLI link once. This
links the files already on your device; it needs no package download:

```sh
npm link --offline --ignore-scripts --no-audit --no-fund
cd /absolute/path/to/your/code/repository
grove init --dry-run
grove init
```

`grove init` registers the current Git checkout, builds its graph and prints the
checkout ID plus an absolute local MCP command for an approved coding agent.
`--dry-run` previews the repository, store and file counts without creating a
store or changing the repository. Repeating `grove init` reuses the same checkout
record and snapshot when nothing changed. Neither command edits your repository
or agent configuration. The persistent store lives outside the clone, so another
clone with the same normalized Git origin can use its retained memory.

If global npm links are restricted, use the bundled CLI directly from anywhere:

```sh
node /absolute/path/to/Grove/src/cli.ts init --dry-run
node /absolute/path/to/Grove/src/cli.ts init
```

To initialize a specific checkout without changing directories, run
`grove init /absolute/path/to/checkout`. Use `--home /absolute/store` to choose a
private store. To recognize an intentional origin change, use `grove init --fork`.
For agent setup, paste the printed `mcp.command` and `mcp.args` into your local
client's stdio MCP settings; use the configuration example below. Grove does not
contact an agent provider or configure cloud access.

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
- Bounded JSON context results, a local stdio MCP tool, an optional local policy,
  and consistent SQLite backup/restore. Source backup is not implemented.

## Requirements and installation

- Node.js 24.14 or later; Git on PATH.
- No `npm install` or network access is needed. The parser runtime and selected
  grammars are included under `vendor/tree-sitter/` with their MIT license.
- Provision Node, Git and the Grove files through your organization's approved
  offline distribution method. Publishing this source to GitHub is a development
  activity outside the application's runtime.

Use `grove --help` for every command. `grove init` is the usual first command.
The lower-level `register` and `index` commands remain available when you need
to run those steps separately. The init output contains a checkout `id`; use it
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

Grove's MCP server is a local subprocess, bound to one checkout. Run it directly:

```sh
node /absolute/path/to/Grove/src/mcp.ts --checkout <checkout-id> --home /absolute/grove-store
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
        "/absolute/path/to/Grove/src/mcp.ts",
        "--checkout", "REGISTERED_CHECKOUT_ID",
        "--home", "/absolute/path/to/local-store"
      ]
    }
  }
}
```

The server follows MCP's
[stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
and advertises protocol version 2025-06-18. Its only tool,
`grove_context`, accepts `query` and optional `maxBytes` (1024–32768). It
refreshes the bound checkout, returns matching file paths, symbol/import names
and reviewed memory, and reports omissions. It does not switch checkouts or
write memory. Start a separate server per checkout. The server inherits the
current user's filesystem permissions; checkout binding is application-level
scoping, not an operating-system sandbox. Specific Codex, Claude Code and
Copilot versions still need live compatibility tests.

**An offline Grove process does not make its coding agent offline.** Cloud-backed
agents may send returned context to their providers. Strict device-only use needs
an approved local client/model with outbound network access denied.

## Test and release checks

```sh
node --test test/*.test.ts
```

Tests use temporary local Git repositories. They cover clone recovery, dirty-copy
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
6. **Scale and security:** measure first/repeat indexing and peak memory on
   representative 1k, 10k and largest target repositories. Test concurrent
   clients, edits during indexing, filesystem permissions and network denial
   on every target OS. Set pass thresholds before rollout.

Compare output bytes, model tokens, task time and correctness against pinned
no-Grove and Graft baselines. Grove has no measured savings claim yet. Current
limitations include repeated full-file hashing, no automatic prompt rewriting,
contradiction resolution, source backup, or cross-device synchronization.

[Security boundaries](SECURITY.md) give the data and trust model. The full CLI
command list is available with `grove --help`.
