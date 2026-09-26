# Grove 0.3 acceptance testing

Grove 0.3 is a controlled release candidate. Record the exact operating system,
Node/Git versions, agent client versions, repository size, policy file and results.
A passed unit suite alone is not organization production approval.

1. **Offline launch:** provision Node, Git and this repository from an approved
   offline medium. Deny all process egress and run `node --test test/*.test.ts`.
   Confirm no runtime package installation, telemetry or remote Git request occurs.
2. **Repository lifecycle:** register two clones with the same origin on distinct
   branches. Change a tracked file in one. Confirm different snapshot IDs. Delete
   one clone, run `status`, then `mark-deleted --confirm`. Register a fresh clone
   and confirm reviewed memory appears only if its evidence hash matches.
3. **Conflicts:** create an unmerged Git index locally. `graph` and `context`
   must fail for that checkout. Resolve the merge and verify indexing resumes.
4. **Parsing and policy:** index TypeScript, JavaScript and Python fixtures with
   imports, classes, functions and methods. Check unresolved imports are labeled.
   Confirm denied paths never appear. Change policy and verify a new snapshot and
   stale/excluded memory. Enable sourceSearch only for a controlled test; check
   returned metadata contains path/line without source text.
5. **Recovery:** make `backup`, restore into a new directory, then run `status`,
   `graph` and `memories` with `--home` pointing to the restored store. Verify a
   second restore to that directory and backup overwrite both fail.
6. **Agent clients:** for each approved *offline* Codex, Claude Code and Copilot
   version, register one checkout and configure the absolute stdio command from
   README. List tools, call `grove_context`, switch the bound checkout branch,
   and confirm context follows that checkout only. Capture protocol failures.
7. **Performance:** measure first/repeat index and context latency plus peak RSS
   on representative 1k, 10k and largest intended repositories. Compare returned
   bytes and model token usage against a pinned no-Grove and Graft baseline. Set
   release thresholds from actual task needs; current tests establish no SLO.
8. **Concurrency/security:** run multiple clients against the same store, edit
   files during indexing, run integrity checks, inspect local permissions, and
   verify sandboxed filesystem/network behavior on each target OS.

Track failed checks and their fixes before changing the release status in README.
