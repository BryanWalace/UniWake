# Phase 7 review — Code Reviewer

Date: 2026-10-09 · Lens: security and testability of a new LAN surface.

- **R7-01 (MAJOR)** Port 47102 is a new unauthenticated surface (pairing). → only answers pairing
  while a code is open; per-IP rate limit; message size limit (8 MB pairing, 64 MB sync); 30 s
  deadline per pairing connection; Zod validation of every message (plan §14.3, §14.5).
- **R7-02 (MAJOR)** Tests must never broadcast on the real network (CLAUDE.md). → announcer targets
  are injected; tests use 127.0.0.1 only and the network guard stays on.
- **R7-03** Member secrets are shown to the other member during `hello`. An insider could collect
  them; insiders already hold the team key. Accepted (ADR-038), documented.
- **R7-04** Audit: pairing (success/failure), revoke, rename, leave and joins are audited (FR-006).
- **R7-05** Every v1.2 AC has an ID that `check:trace` enforces; the two-instance test is
  required by the owner (M14-T04).
