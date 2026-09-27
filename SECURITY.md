# Security boundaries

Grove is a single-user local release candidate. Do not treat it as a sandbox or
as an audited enterprise security boundary.

The runtime has no networking features and invokes only fixed read-only local Git
queries. Tests check this surface statically, and the suite is exercised with
macOS network denial. The release README describes validation coverage. Cross-platform child-process hardening and
deployment-specific checks are still required before strict deployment.

Explicitly selected agent setup writes project-local MCP JSON configuration.
It preserves unrelated entries, rejects unmanaged Grove entries and existing
symlinked targets, and uses temporary files plus rename for each configuration.
Multiple configuration files are not a single filesystem transaction; an I/O failure
can leave one agent configured and another pending. Rerun init after resolving the
error. Configurations contain local paths; review them before sharing.

The stdio MCP server exposes metadata and reviewed memory to its local client.
Bundled WASM parsers process tracked source locally. Optional source search scans
current bytes and returns paths/line numbers, without retaining text. Backup files
contain the same sensitive metadata and memory as the live SQLite store.
A client may transmit those results independently; strict device-only use requires
an approved offline client/model with egress disabled. Each server binds one checkout.

The database contains repository identifiers, absolute checkout paths, file metadata,
and user-provided memory text. It is not encrypted. Access must be controlled by
device permissions and organizational disk-encryption policy. A user who controls
the process or database can alter memory and identities.

Source indexing is allowlisted, skips symlinks and oversized/binary files, and does
not retain source bodies. Tracked source can still contain secrets: file classification
is not secret detection. Memory text is stored as entered. Symlink checks reduce
accidental escapes but do not provide an adversarial, race-free filesystem sandbox.

Remote URLs are identity hints, not authority to retrieve confidential knowledge.
There is no multi-user permission model in this release. Do not share the database
on a network filesystem. Missing paths are never automatically considered deleted.

Report suspected vulnerabilities privately through GitHub's security reporting
facilities when available; avoid publishing sensitive repository data or credentials
in issue reports. No reporting action is performed by the application.

Offline prompt suggestions append retrieved data without model inference. They
preserve the original request, but appended memory is still untrusted reference
text. A consuming model must not treat it as instructions. No prompt is submitted
by Grove.

Manual memory bundles are plaintext and unauthenticated. Repository and bundle
hashes identify data; they do not prove who supplied it. Imports validate format,
size and identity and are committed as a transaction. Imported memory is always a
candidate until human review is explicitly confirmed against matching evidence.
Conflicting statements are retained separately; Grove does not establish semantic
truth. Exported memory can contain secrets entered by the user even though source
bodies and checkout paths are not added by the exporter.
