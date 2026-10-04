# Phase 3 review — Architect

Reviewed: `specs/tasks.md` v0.1 · Date: 2026-10-04
Method: mechanical traceability check (script over `spec.md` and `tasks.md`) + reading.

## 1. Traceability result
- **117 ACs** in spec v1.1; **113** referenced by a task.
- **Unmapped ACs:** AC-001-01b ([manual]), AC-002-06 [E2E], AC-008-05 [E2E], AC-009-01 [E2E].
- FR sub-requirements FR-003.7, FR-003.8, FR-004.3, FR-005.4, FR-005.5, FR-005.8 appear only in
  shorthand ("FR-003.4–7", "FR-005.1/8"). Acceptable for humans, but it defeats automated checks.
  *Ask:* write refs in full in v1.0.
- **NFRs with no task:** NFR-02 (covered indirectly through ACs; say so), NFR-06 (CI tasks),
  NFR-07 (axe only on the dashboard; spec requires six pages), NFR-08 ([manual] → Phase 5),
  NFR-09 (Edge is never exercised).

## 2. Plan conformance
- **M1 auth deviation: approved.** It follows constitution §6.2 and plan §6; the brief's
  milestone list is a grouping, not a dependency order. No ADR needed beyond this note; the
  deviation is recorded at the top of `tasks.md`.
- **Missing: retention and cleanup jobs** (history 180 d, packet log 30 d, audit 365 d, expired
  sessions, enrollment tokens) required by spec §9 and plan §5.1. Nobody owns them.
- **Missing: settings take effect at runtime.** Services must react to setting changes (sweep
  interval, thresholds) without restart; settings that need a restart (ports, binds) must say so in
  the UI.
- **Phase 5 has no tasks.** Add a validation section so the end of the project is planned too.

## 3. Verdict
Approve after the gaps above are fixed in v1.0.
