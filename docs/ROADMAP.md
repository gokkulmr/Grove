# Roadmap

## Implemented in 0.1

- Persistent SQLite repository and checkout registry.
- File graph snapshots and same-source snapshot reuse across independent clones.
- Missing versus explicit-deleted tracking without destructive file operations.
- Separate code state per checkout, worktree handling, and merge-conflict blocking.
- Explicit changed-origin fork registration with lineage.
- Evidence-linked memory with current-file hash checks.
- Local-only CLI and integration tests.

## Implemented in 0.2 developer preview

- Ranked path and reviewed-memory retrieval, with snapshot provenance.
- UTF-8 byte budgets and explicit omitted-result counts.
- One-checkout-per-process stdio MCP tool with protocol integration tests.
- Legacy storage compatibility under the Grove name.

## Implemented in 0.3 release candidate

- Bundled Tree-sitter grammars for TypeScript, JavaScript and Python; symbols/imports
  and parsed-file cache keyed by file hash and parser version.
- Store policy for extension, prefix, size and file-count limits.
- Optional on-demand source search returning line numbers without source text.
- SQLite backup/restore with integrity checks and no overwrite.

## Before organization production use

1. Real-client acceptance on supported Codex, Claude Code and Copilot versions.
2. Representative large-repository and concurrent-client benchmarks.
3. Incremental manifest reuse and queued indexing; current file hashing is repeated.
4. Security review of bundled parsers and stronger file capture under races.
5. Cross-platform network-denial checks, installer/distribution testing and backup drills.
6. Administrator rollout policy, migrations and multi-user access boundaries.

## Then: agent access and context efficiency

- Real-client acceptance tests for the stdio MCP server; version-tested adapters.
- Richer source search, graph traversal and measured model token budgets.
- Memory revision, contradiction and supersession workflows.
- Context epochs and evidence delivery tracking across compaction.
- Deterministic prompt preparation preserving original user intent.
- Evaluate against a pinned Graft baseline; no claimed savings until measured.

## Deliberately outside the offline contract

No hosted memory, telemetry, automatic update checks, Git transports, remote inference,
or cross-device network sync. Manual export/import of reviewed memory may be designed
later, if organizational policy permits data to leave its originating device.
