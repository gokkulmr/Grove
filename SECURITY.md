# Security boundaries

ProjectG is an early single-user local prototype. Do not treat it as a sandbox or
as an audited enterprise security boundary.

The runtime has no networking features and invokes only fixed read-only local Git
queries. Tests check this surface statically. OS-level network-denial tests and
cross-platform child-process hardening are still required before strict deployment.

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
