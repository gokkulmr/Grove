# Architecture

ProjectG owns its storage and runtime. Graft is a reference, not an installed dependency.

```mermaid
flowchart LR
  CLI[Local CLI] --> Registry[Repository and checkout registry]
  Registry --> Git[Fixed read-only Git queries]
  Registry --> Files[Tracked source manifest]
  Files --> Snapshots[Immutable SQLite snapshots]
  Snapshots --> Graph[Repository and file graph]
  Registry --> Memory[Evidence-linked local memory]
```

## Identity

A normalized origin maps independent clones to one repository record. Each path has
its own checkout record and latest snapshot pointer. Hosted remote credentials and
query strings are not persisted. GitHub paths are normalized case-insensitively;
other forge paths preserve case. SSH host aliases and non-default ports are not
automatically equated. Repositories without origin use their common Git directory;
independent clones without remotes need a future explicit alias workflow.

Changed origin is a blocking identity transition until explicit `register --fork`.
No forge API is used. Repository aliases are identity hints in a single-user
prototype, not an authorization boundary. Organization policy is future work.

## Snapshots and concurrency

Snapshot IDs hash the repository ID, engine version, HEAD and sorted working-tree
manifest (including exclusions). Lineage labels do not decide code state.
File hashes describe current working-tree bytes for tracked files, including local
edits. Staged content is not captured as a separate version. The index never loads source
objects from Git and never invokes object transports. Two hashing passes and Git
metadata checks reject changes observed during indexing. Source is not retained.

A transaction inserts a complete snapshot and switches the checkout pointer.
An existing identical snapshot is reused. SQLite serializes writers with a busy
timeout; readers can retain the last complete view through WAL. A dedicated job
coordinator and large-repository incremental artifact store are later work.

The published graph is deliberately file-level. `contains` is the only relation.
We do not approximate semantic call relationships with regexes and claim they are resolved.

## Memory

Memory belongs to a repository, not to a path. It is candidate or explicitly reviewed.
Optional evidence consists of an indexed source path and its content hash.
Retrieval reindexes the target checkout and compares evidence. `matching` means
matching file bytes, not verified meaning; dependency-sensitive freshness is future work.
No automatic model-generated memory or automatic promotion is present.

## Checkout lifecycle

`status` actively probes each stored path. Missing is separate from inaccessible and
from explicit deletion. `mark-deleted --confirm` records an event after absence is
observed. Reappearance can reactivate a checkout. Remote/common-directory mismatch
is identity-changed. Merge conflicts are reported from Git's unmerged index entries;
ProjectG will not index that checkout until Git records them as resolved.

Historical file snapshots remain queryable in the database, but are never labeled
current through `graph` when the checkout is missing, conflicted, or inaccessible.

## Offline contract

Runtime dependencies are Node built-ins and local Git. There is no socket listener,
HTTP client, updater, telemetry, package download, or LLM integration. Development
publishing to GitHub is external to ProjectG. A strict organization rollout must also
deny egress at the operating-system boundary and audit the child-process environment.
