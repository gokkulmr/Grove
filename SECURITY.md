# Security boundaries

Grove is an early single-user local prototype. Do not treat it as a sandbox or
as an audited enterprise security boundary.

The runtime has no networking features and invokes only fixed read-only local Git
queries. Tests check this surface statically, and the 17-test suite passed with
macOS network denial on 2026-09-23. Cross-platform child-process hardening and
deployment-specific checks are still required before strict deployment.

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
