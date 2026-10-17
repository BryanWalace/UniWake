# M28 review — Excluded machines visible; saving never shuts down at once (v1.6.0)

Date: 2026-10-17 · Scope: M28-T01..T03 · `power-orders.ts` (preview with schedule rules),
`power-status.ts` / `reconcile.ts` (excluded result), `scheduler.ts` and `domain/agenda.ts`
(ADR-058), `ShutdownReach.tsx`, `PowerHistorySection.tsx`.

## Debug
- Root cause of the v1.5.0 field test proven from the owner's log and the code: the schedule's only
  machine was excluded ("1 excluída"), while the form used the **manual** preview, which counts a
  "Nunca desligar" machine as ready (it is included there with a confirmation). Fixed: the reach uses
  the schedule's rules (AC-601-01, server and web).
- The pushes 100 s after T came from saving a time that had just passed; ADR-058 drops instants at or
  before the last save on both paths (AC-602-01), late pushes after a hub outage unchanged (AC-602-02).

## Architect
- `updatedAt` is replicated, so every team hub serves the same agenda; no new column, no migration.
- **A-M28-01 (MINOR, pre-existing)** changing the *time* during an item's warning does not cancel the
  item the agent is already running (agenda changes never cancel; only cancel orders do). Unchanged.

## Code Reviewer
- `excluded` is a new `ShutdownResult`; history counts it apart from "x/y desligaram"; the T+10 text
  names each reason. Manual "Desligar" preview behaviour unchanged (asserted).

No open CRITICAL/MAJOR. **M29 may start.**
