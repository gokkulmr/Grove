# Local agent context (0.2 developer preview)

Grove implements a narrow MCP server using the pinned
[2025-06-18 stdio specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
[lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), and
[tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
No npm install, downloaded adapter, socket listener or model is required.
This is a protocol-tested implementation; specific Codex, Claude Code and Copilot
versions have not yet passed live acceptance tests. Do not claim certified support.

## Configure explicitly

First register a local checkout with `node src/cli.ts register /absolute/repo`.
Copy its ID into your client's stdio MCP configuration. The usual configuration
shape is shown below; client-specific keys may differ. Use absolute paths so the
client's current directory cannot change which executable or script is launched.

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

This configuration is an example, not an automatic installation. One server
process is bound to one registered checkout. Tool arguments cannot change that
binding, register paths or access other repositories. Start another process for
another checkout. The process inherits the host user's filesystem permissions;
this binding is application-level scoping, not an OS sandbox.

**An offline server does not make its client offline.** A cloud-backed coding agent
may forward tool results to its provider. Under the project's device-only policy,
use a local client/model with outbound access disabled. No client is configured or
contacted by Grove itself. Memory text and paths can contain confidential data.

## Tool behavior

`grove_context` takes `query` (1–1000 characters containing at least one word) and
optional `maxBytes` (1024–32768, default 8192). It searches case-insensitive substrings
of query words in file paths and memory text. Matches are OR-based, ranked by the
number of distinct matching words; stable ties use kind and path/memory ID.
This is a metadata search, not semantic or source-content search.

Each call reindexes the bound checkout before retrieval. Only reviewed memories
with matching source-file hashes are included. Candidates and stale memories are
counted in `withheldMemories`, without returning their text. Conflicted, missing,
inaccessible or identity-changed checkouts return a tool error. Different dirty
copies use different snapshots. File-level evidence matching does not establish
truth or freshness of a statement about other files.

The compact result includes repository, checkout and snapshot IDs, indexed/skipped
file counts, matches, omissions and selected items. Items are included whole;
oversized items are skipped rather than cutting a statement or JSON in half.
The payload's UTF-8 byte length is bounded. MCP JSON escaping/envelope and the CLI
newline are additional bytes. No claimed token savings or exact tokenizer estimate
is provided. Retrieved text is untrusted data, not additional user instructions.

## Transport and limitations

The client sends newline-delimited JSON-RPC, beginning with `initialize`, then
`notifications/initialized`. Grove advertises version 2025-06-18; a client that
cannot use that version should disconnect. Supported requests: `initialize`,
`ping`, `tools/list`, and `tools/call`. There are no prompts, resources, subscriptions,
remote HTTP transport, sampling, authentication endpoints or write-memory tools.
The tool is marked as non-destructive but not read-only because snapshot refresh
writes local cache and event records. It never modifies repository files.

Input messages are limited to 64 KiB; excessive input terminates the process.
Malformed JSON receives a parse error. EOF closes the database; an unterminated
final message exits with an error. stdout contains only protocol responses;
diagnostics use stderr. Requests execute serially and cannot currently cancel an
in-progress index. Repeated calls hash all allowed files twice, so large-repository
latency remains a release bottleneck. Output size limits do not bound indexing work.

## Before an organization release

- Run live acceptance tests in each supported local client and record versions.
- Verify process-level network denial on every target operating system.
- Measure index/query latency and output sizes on representative repositories.
- Add incremental indexing, administrator policy and database backup/restore.
- Test stronger snapshot consistency under concurrent saves and concurrent clients.

The current milestone is suitable for a controlled developer pilot, not a claim
that the entire organization-ready product is finished.
