# M27 review — Diagnostics (v1.6)

Date: 2026-10-16 · Scope: M27-T01..T03 · `domain/agenda.ts` (explain, one-offs),
`application/power/{agenda-service,diagnostics,shutdown-test,power-status,reconcile}.ts`,
enrollment duplicate notice, `routes/power.ts`, `ShutdownDiagnosticsPanel.tsx`, installer.

## Debug
- The per-schedule explanation uses the agenda's own matching rules (`explainAgenda` next to
  `buildAgenda`), so "Inclui esta máquina" and the agenda cannot disagree (AC-502-01).
- The log test confirms the field's served version `8a818e7a…` is the digest of an empty agenda.
  On a lab PC the panel now says which rule left it out (target, tag, flag, disabled), and the
  dashboard warns when preparation created a second record with the same computer name
  (AC-502-02).
- "Testar agendamento" goes through both paths with one run id. Fake-agent tests cover push +
  agenda (runs once, by order) and hub off (runs by agenda, the late push answers `already_done`)
  (AC-504-01).
- **D-M27-01 (fixed in review)** an exception while reconciling one test would have aborted the
  scheduler's reconciliation step on every tick (shared `try`). Each test is now isolated, with a
  test.
- **D-M27-02 (fixed outside M27, ADR-057)** CI installer smoke: WinSW 2.12 `stopwait` returned -1
  after a clean stop ("The handle is invalid" in `GetChildren`). The installer now waits for the
  SCM state. The next Windows CI run passed.

## Architect
- `power_tests` stays machine-local (ADR-056). Its reconciliation counts go to the existing
  `power_reconciled`, so migration 008 is unchanged.
- **A-M27-01 (MINOR, known limit)** in team mode, a test created on hub A for a PC that checks in
  with hub B reaches it only through A's pushed order (B's agenda has no one-off). That is the
  intended "a test from the hub the PC talks to"; the dialog's wording assumes it.
- `OccurrenceScope` lets the same "missing machine" classifier serve schedules and tests. There
  is no second copy of the ADR-054 rules.

## Senior Fullstack
- Route `POST /api/devices/:id/shutdown-test` (operator, zod 2–60 min, audited `power.test`).
  Refusals have pt-BR messages: `POWER_TEST_NOT_READY` and `POWER_TEST_PROTECTED` (plan §6.6
  updated).
- Device page: the test row says only what the hub knows ("agendado (a máquina recebe na próxima
  consulta…)" / "ordem enviada…"), then the result and path (wording fixed in review).

## Code Reviewer
- Logs (FR-504.2): "schedule fired" (action, schedule, targets), "agenda changed" (device,
  version, previous, items, next), "agenda served with a new version", pushed/reconciled with
  the occurrence. A repeated check-in logs nothing (asserted).
- No `Date.now()` in services; ids from the injected `newUuid`; no real network or shutdown in
  tests.

No open CRITICAL/MAJOR. **Phase 14 (validation) may start.**
