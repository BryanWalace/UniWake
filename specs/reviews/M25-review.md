# M25 review — Scheduled shutdown: push, one execution, reconciliation (v1.6)

Date: 2026-10-15 · Scope: M25-T01..T05 · scheduler `tickShutdowns`, `PowerOrdersService.startScheduled /
retryScheduled`, `ShutdownReconciler`, `SelfDeviceService`, agent `Invoke-UwAnswer` / `Get-UwNextJob`,
migration 008, web history/form/dialog.

## Architect
- Push reuses the manual-shutdown service end to end (resolution, readiness, orders, live job,
  audit); no parallel implementation. Identity: job UUID = occurrence UUID; order UUIDs v5 of
  occurrence + device UUID (+ "retry"), so restarts and team hubs converge.
- Wake path: only the shared repo filter changed; regression test AC-501-07.
- Old 1.3 agents receive orders with an extra field they ignore and self-update at the end of
  the same run; an old agent that runs the pushed order shuts the PC down before T, so its agenda
  item can only be skipped as `was_off` afterwards — no double execution in practice.

## Senior Fullstack
- Reports may now carry occurrence and order together (contract relaxed and tested); pushed
  orders carry T so a machine shut down only by the order still lands in its schedule's history.
- The "Desligar" schedule form shows who the schedule reaches today and the hub-PC warning.

## Debug
- **D-M25-01 (MAJOR, fixed before commit)** an order for an occurrence the agenda had already run
  would have been settled as **failed** (skipped → failed) and counted as "estava desligada" in
  the history → new report reason `already_done`: the hub records the order as executed and the
  history ignores that report.
- **D-M25-02 (MAJOR, fixed before commit)** at T + 10 a user postponing is invisible to the hub (the
  agent reports only at the end), so the machine looked "ainda ligado" and would get a retry →
  logged-on user inside the postpone window = "adiado — usuário ativo", no retry.
- Fake-agent tests: pull per target type and per change, push timing/exclusions, once on both
  paths (hub and Pester), hub off at T, nothing after T + 60, reconciliation of seven situations
  with exactly one retry, hub-PC preview.

## Code Reviewer
- Reconciliation only for runs this hub claimed (one retry per run in team mode).
- Logs: push and reconciliation at info, agenda served only on version change.
- **R-M25-01 (INFO)** the field's empty agenda is still not reproduced; "agenda desatualizada" in
  the reconciliation and the reach shown in the schedule form now make it visible on the
  institution's data (M27 adds the per-schedule explanation).

No open CRITICAL/MAJOR. **M26 may start.**
