# Phase 11 review — Architect

Date: 2026-10-12 · Scope: spec §6c, plan §16, ADR-049..052, tasks M21–M24 + Phase 12.

- **A11-01 (MAJOR)** Substituir with only some sections would leave schedules pointing at rooms,
  tags or devices that were wiped (targets reference them). → Substituir needs Cadastro and
  Agendamentos in the file; stated in FR-403.3 and ADR-051.
- **A11-02 (MAJOR)** Importing the hub signing key on a PC that already prepared lab machines would
  make those machines reject every answer (they pin the old key). → key imported only when this PC
  has no prepared machine; the preview says so (FR-403.3, ADR-051).
- **A11-03 (MINOR)** History entities reference schedules/devices: without Agendamentos/Cadastro in
  the same file the applier drops them as orphans. Acceptable; the preview counts them as
  "ignorados" (FR-403.2).
- **A11-04 (INFO)** Reusing the sync snapshot/applier keeps one serializer and one conflict policy
  (roadmap §A pays off). The `format` field, not the schema version, versions the file.
- **A11-05 (INFO)** No new replicated entity, no migration needed beyond machine settings (they
  live in `machine_settings`, defaults in code).
