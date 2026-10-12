# M21 review — Format, secrets, export (v1.4)

Date: 2026-10-12 · Scope: M21-T01..T03, M21-D · `application/migration/{document,secret-box,export-service}.ts`,
`adapters/export-codec.ts`, `POST /api/migration/export`, `HubKeyService.exportKey/importKey`.

## Architect
- One serializer for sync and export: the file carries the change log's upserts (the same
  snapshots a peer receives), so a merge import behaves exactly like a sync (ADR-049/051).
- `document.ts` moved from `domain/` to `application/migration/` because it hashes with
  `node:crypto` (constitution §2.1 keeps `domain/` free of Node built-ins); plan §16.2 updated.

## Senior Fullstack
- Export is a POST returning bytes with `Content-Disposition` (password in the body, not the URL).
- New error codes are in the catalog test and plan §6.6.

## Debug break-it (M21-D)
- Zip bomb, garbage, malformed bodies, empty hub, repeated sections, long and non-ASCII
  passwords, concurrent exports: all handled; no defect found.
- **D-M21-01 (MINOR, fixed before commit)** a file could declare argon2 memory up to 1 GiB and make
  the importer allocate it → capped at 128 MiB in the document schema.

## Code Reviewer
- Password never logged or audited (test asserts the audit has no password); secrets never in
  clear in the file (AC-402-02); wrong password and tampering give one error (AC-402-01).
- Tombstones are not exported, so a merge import can never delete (FR-403.3).

## Open items (INFO)
- **R-M21-01** `importKey` assumes the imported key id is not a retired key of this same PC
  (re-insert would hit the primary key). Only possible when re-importing this PC's own old key;
  M22 handles it by reactivating the retired row.

No open CRITICAL/MAJOR. **M22 may start.**
