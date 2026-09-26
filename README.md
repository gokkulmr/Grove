# Grove

Grove is a local repository graph and memory store for coding agents. It joins
independent clones by normalized Git origin, keeps metadata when a clone is deleted,
and checks memory evidence against the checkout you are using. All application
operations use local files and fixed read-only Git commands. Grove has no updater,
telemetry, model API, socket listener, or Git remote transport.

**Status: 0.3 release candidate for controlled testing.** No organization-wide
production claim has been made. The required acceptance checks are listed below.
The project is MIT licensed. Graft inspired the design; no Graft source is copied.

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

From a copy of this repository:

```sh
node src/cli.ts --help
node src/cli.ts register /absolute/path/to/a/checkout
node src/cli.ts status
```

The register output contains a checkout `id`. Use it in later commands:

```sh
node src/cli.ts index <checkout-id>
node src/cli.ts graph <checkout-id>
node src/cli.ts remember <checkout-id> "Retries are bounded." --evidence src/retry.ts --reviewed
node src/cli.ts memories <checkout-id>
node src/cli.ts context <checkout-id> "retry" --max-bytes 8192
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
node src/cli.ts mark-deleted <checkout-id> --confirm
```

That records a user-confirmed state; graphs and memory remain. Register a new
clone with the same normalized origin to recover its repository identity.
Evidence is checked against that clone's current files. If an origin changes,
Grove blocks silent identity mixing. To record the new identity and lineage:

```sh
node src/cli.ts register /absolute/path/to/checkout --fork
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
node src/cli.ts backup /absolute/backup/grove-2026-09-26.sqlite
node src/cli.ts restore /absolute/backup/grove-2026-09-26.sqlite /absolute/new-grove-store
node src/cli.ts status --home /absolute/new-grove-store
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
node src/mcp.ts --checkout <checkout-id> --home /absolute/grove-store
```

For an agent, point its stdio MCP configuration at an **absolute** Node executable
and an **absolute** `src/mcp.ts` path. Set `--checkout` to the registered ID and
optionally `--home` to the store. An example configuration and the protocol
boundaries are in [docs/MCP.md](docs/MCP.md). The only tool, `grove_context`, accepts
`query` and optional `maxBytes` (1024–32768). It cannot switch checkouts or write
memory. Start a separate server per checkout. Real-client compatibility with
specific Codex, Claude Code and Copilot versions still needs acceptance testing.

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

Release acceptance still requires representative large-repository latency and
memory benchmarks, parser behavior across supported languages, simultaneous
client access, backup recovery on a second device, and a security review of the
bundled parser and filesystem boundary. Grove cannot promise exact token savings
until it is compared against a pinned baseline on real tasks. No automatic prompt
rewriting, contradiction resolution, source backup, or cross-device sync exists.

See the [acceptance test plan](docs/TESTING.md), [architecture](docs/ARCHITECTURE.md),
[MCP guide](docs/MCP.md),
[roadmap](docs/ROADMAP.md), and [security boundaries](SECURITY.md).
