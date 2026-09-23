# Grove

**Offline repository tracking, persistent local memory, and versioned code graphs.**

Grove is a standalone project inspired by Graft. It keeps its database outside
your checkouts, so deleting a clone does not delete its retained graph metadata or
memory. All runtime operations stay local. There is no hosted backend, telemetry,
update check, remote model, or Git network operation.

## Status: 0.2 developer preview

Version 0.2 implements the storage and correctness foundation:

- SQLite registry shared by local clones and local sessions.
- SSH/HTTPS remote normalization; repository names alone never determine identity.
- Immutable **file-level** graph snapshots, including tracked source files with
  uncommitted changes. Different working copies do not overwrite one another.
- Available, missing, inaccessible, conflicted, identity-changed, and explicitly
  user-confirmed deleted states. Missing is never automatically called deleted.
- Retained snapshots and memory after checkout deletion.
- Explicit fork handling when a checkout changes its origin remote.
- Local Git merge-conflict detection; affected checkouts cannot publish current graphs.
- Candidate/reviewed memory with source-file fingerprints and matching/stale/unknown status.
- A JSON CLI and integration tests using temporary repositories.
- Ranked search of tracked file paths and reviewed memory, with bounded UTF-8 output.
- A checkout-bound local stdio MCP server exposing `grove_context`.

**Not implemented yet:** function/class extraction, call graphs, Tree-sitter,
source-content search, exact token budgeting, automatic watching, prompt rewriting,
source backup/restore, multi-user access control, and cross-device sync.
The graph currently contains repository and file nodes with `contains` edges.
This is a developer prototype, not an enterprise security certification.

## Requirements and offline use

- Node.js **24.14 or later** (native TypeScript execution and `node:sqlite`).
- Git on PATH.
- No npm install, build, network service, or third-party runtime package is needed.

Provision Node, Git, and these project files through your approved offline process.
GitHub distribution and publishing are development activities, not application
runtime features. Grove only reads local Git metadata; it never fetches, pulls,
pushes, or contacts a remote. Remote URLs are identity hints, not authentication.

```sh
node src/cli.ts --help
node src/cli.ts register /absolute/path/to/your/clone
node src/cli.ts status
```

Copy the returned checkout `id` for subsequent commands:

```sh
node src/cli.ts index <checkout-id>
node src/cli.ts graph <checkout-id>
node src/cli.ts remember <checkout-id> "Retry count is intentionally bounded." --evidence src/retry.ts --reviewed
node src/cli.ts memories <checkout-id>
```

`--reviewed` records **your** assertion of review; matching fingerprints do not
prove the statement is true. Evidence must be a tracked source file included by
the initial indexing policy. Candidate memory without evidence remains unknown.
Claims from two branches can coexist; automatic semantic conflict resolution is
not implemented. Memory listing is inspection, not automatic instruction injection.

When a clone disappears, `status` records `missing`. After confirming actual deletion:

```sh
node src/cli.ts mark-deleted <checkout-id> --confirm
```

This changes a registry status only. It deletes no source, snapshot, or memory.
An unplugged drive can look missing; Grove does not infer why a path disappeared.
Register a new clone with the same normalized origin to recover its repository
identity and memory. Evidence is rechecked against that clone's current source.

If origin changes, Grove refuses to silently mix identities:

```sh
node src/cli.ts register /absolute/path/to/clone --fork
```

This explicitly associates the checkout with the destination identity, records
lineage when creating that repository record, and retains the original repository's
snapshots and memory separately. It does not verify any remote push succeeded.

## Storage and boundaries

Default storage: `~/.projectg/projectg.sqlite` with SQLite WAL sidecars.
Override with `GROVE_HOME` or `--home /absolute/store/path`.
The legacy `PROJECTG_HOME` variable remains supported; `GROVE_HOME` takes precedence.
The `.projectg` directory and `projectg.sqlite` filename are deliberately retained
so renaming the application does not strand existing snapshots and memory. The store must live
outside every registered checkout. New directories use private permissions and
the database is restricted to its owner on POSIX systems. Use a dedicated directory.

- The first index includes **tracked source files only**, at most 1 MiB each.
- It excludes symlinks, binaries, build/vendor directories, and unsupported extensions.
- Untracked files, Markdown/configuration, submodules, and nested repositories are not indexed.
- Only file hashes, paths, sizes and line counts are retained; **no source bodies**.
- User-entered memory text is retained verbatim. Do not enter secrets.
- This is **not a source backup**, and does not restore a deleted checkout.
- A double-read check detects ordinary concurrent saves; it is not an OS-level atomic filesystem snapshot.
- Two people on different devices cannot coordinate through this offline application.
  Git merging happens outside Grove; it detects local unmerged files and waits for resolution.
- SQL data is not encrypted automatically. Use device encryption and approved permissions.
- Read-only local Git commands disable filesystem monitoring and lazy object fetching.
  Git/Node/OS executables and the local device remain trusted dependencies.

## Agent context

```sh
node src/cli.ts context <checkout-id> "retry policy" --max-bytes 8192
node src/mcp.ts --checkout <checkout-id>
```

Context retrieval searches paths and reviewed memory text, refreshes the snapshot,
and excludes candidate or stale memory. Output identifies omitted results and
excluded files. The byte limit applies to compact JSON, excluding its trailing
newline and MCP framing; it is not an exact model token budget. Source bodies are
not returned. See [local MCP setup and boundaries](docs/MCP.md).

## Development

```sh
node --test test/*.test.ts
```

Tests create only local temporary repositories, never contact GitHub, and cover
delete/re-clone recovery, dirty-copy isolation, worktrees, changed remotes, merge
conflicts, stale memory, symlink exclusion, and transactional persistence.
The dependency/network surface test is a static regression check, **not proof of
OS-enforced egress isolation**. The 17-test suite also passed under macOS
`sandbox-exec` with `(deny network*)` on 2026-09-23. This validates those exercised
paths on this machine; deployment-level and cross-platform checks remain pending.

See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and
[security boundaries](SECURITY.md).

## License and reference

MIT. Graft was used as a design reference; this first implementation contains no
copied Graft source. See [Trail's Graft](https://github.com/trailhq/Graft).
