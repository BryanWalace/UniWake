# Phase 13 — Senior Fullstack

- Orders gain an optional `occurrence` (shared schema); old agents ignore unknown fields and
  self-update to the new script at their next check-in (signed hashes).
- Scheduler: shutdown occurrences use the same `decideRuns`/lease/claim as wakes but a different
  due window (from T − warning − 1 min to T + 60 min); wake code untouched except the shared repo
  filter.
- Device page: diagnostics extend the existing "Desligamento remoto" card; "Testar agendamento"
  is a small dialog (minutes 2–60).
- **F13-01 (MINOR)** `Neighbor` lacks the entry state; parse it from `Get-NetNeighbor` (State as int)
  and treat only Reachable (5) as alive.
