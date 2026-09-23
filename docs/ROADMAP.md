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

## Next: code graph and robust persistence

1. Bundle approved Tree-sitter grammars offline; begin with TypeScript and Python.
2. Extract symbols and imports with resolution confidence and parser-version cache keys.
3. Incremental artifact reuse, dependency invalidation, and a queued indexing service.
4. Configurable administrator-owned allow/deny policy; source data retention decisions.
5. Optional explicit source backup, consistent database backup/restore, and migrations.
6. Stronger file capture against concurrent filesystem mutation; platform egress tests.

## Then: agent access and context efficiency

- Real-client acceptance tests for the stdio MCP server; version-tested adapters.
- Source-content search, graph traversal and measured model token budgets.
- Memory revision, contradiction and supersession workflows.
- Context epochs and evidence delivery tracking across compaction.
- Deterministic prompt preparation preserving original user intent.
- Evaluate against a pinned Graft baseline; no claimed savings until measured.

## Deliberately outside the offline contract

No hosted memory, telemetry, automatic update checks, Git transports, remote inference,
or cross-device network sync. Manual export/import of reviewed memory may be designed
later, if organizational policy permits data to leave its originating device.
