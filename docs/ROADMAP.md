# Roadmap

## Implemented in 0.1

- Persistent SQLite repository and checkout registry.
- File graph snapshots and same-source snapshot reuse across independent clones.
- Missing versus explicit-deleted tracking without destructive file operations.
- Separate code state per checkout, worktree handling, and merge-conflict blocking.
- Explicit changed-origin fork registration with lineage.
- Evidence-linked memory with current-file hash checks.
- Local-only CLI and integration tests.

## Next: code graph and robust persistence

1. Bundle approved Tree-sitter grammars offline; begin with TypeScript and Python.
2. Extract symbols and imports with resolution confidence and parser-version cache keys.
3. Incremental artifact reuse, dependency invalidation, and a queued indexing service.
4. Configurable administrator-owned allow/deny policy; source data retention decisions.
5. Optional explicit source backup, consistent database backup/restore, and migrations.
6. Stronger file capture against concurrent filesystem mutation; platform egress tests.

## Then: agent access and context efficiency

- Local stdio MCP and version-tested adapters; explicit checkout/session binding.
- Full-text search and graph traversal with coverage-aware output budgets.
- Memory revision, contradiction and supersession workflows.
- Context epochs and evidence delivery tracking across compaction.
- Deterministic prompt preparation preserving original user intent.
- Evaluate against a pinned Graft baseline; no claimed savings until measured.

## Deliberately outside the offline contract

No hosted memory, telemetry, automatic update checks, Git transports, remote inference,
or cross-device network sync. Manual export/import of reviewed memory may be designed
later, if organizational policy permits data to leave its originating device.
