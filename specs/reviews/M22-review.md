# M22 review — Import and standby (v1.4)

Date: 2026-10-12 · Scope: M22-T01..T03, M22-D · `application/migration/import-service.ts`,
`db/sync/import.ts`, `db/repositories/migration-repo.ts`, migration 007, `/api/migration/*`,
scheduler and agent-route standby hooks.

## Architect
- Merge is the team-sync applier; replace scopes deletes to the replaced entities and then uses the
  same applier, so conflicts (duplicate names/MACs) resolve the same way as in team mode.
- **A-M22-01 (MAJOR, fixed before commit)** the first replace design deleted every row of the
  replaced sections and re-inserted them: devices that are also in the file would get new local
  ids, and `ON DELETE CASCADE` would erase their status, events and test results — on a restore
  onto the same PC, all local history. Replace now deletes only rows the file does not have and
  updates the others in place (test "replace keeps the local id"). Spec FR-403.3 and ADR-051
  amended.
- Migration 007 only widens the backup-kind CHECK (rebuild with every row kept).

## Senior Fullstack
- Import upload is the raw file (`application/octet-stream`, 50 MB route limit); preview/apply take
  the import id; standby state comes from `GET /api/migration/state`.
- The preview classification runs before replace touches the log, so "atualizados" means what it
  says in both modes.

## Debug break-it (M22-D)
- Crash mid-import → rollback (NFR-402); same file twice → unchanged; expiry across a clock jump;
  duplicate MAC → reported, one device; hand-made files with users outside the sealed part or items
  in the wrong section → ignored. No defect beyond A-M22-01.

## Code Reviewer
- Team refusal tested at the service (the panel shows `blocked` at inspect time).
- Standby: scheduler skips due runs (logged like a pause); check-ins get 503 before the token is
  looked at; activation and the import are audited; joining a team clears standby (D11-03, test).
- **R-M22-01 (INFO)** runs skipped in standby are recorded with the pause reason ("pulado
  (pausado)"); a dedicated reason would need a new run status — not worth a migration now.
- **R-M22-02 (INFO)** after a replace that includes Usuários, the importing admin's session is gone
  (sessions are deleted with the users); the preview says so.

No open CRITICAL/MAJOR. **M23 may start.**
