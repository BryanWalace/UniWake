# M26 review — Online status (v1.6)

Date: 2026-10-15 · Scope: M26-T01, M26-T02 · `helper/probe-helper.ps1`, `adapters/icmp.ts`,
`application/monitor/monitor-service.ts`, `db/repositories/monitor-repo.ts`, `domain/neighbors.ts`,
devices repo/API, device page.

## Debug
- Root cause of the field symptom proven and fixed: an empty address made the whole ICMP batch
  fail → deadline → restart → every device of the batch dead. Real-helper tests on Windows
  (process-level and adapter-level) and fake-helper tests for error answers with/without id.
- New signals: agent check-in (≤ 2 min), Reachable neighbor entry (after the probes); offline
  still needs two all-negative sweeps (AC-503-03).
- **D-M26-01 (MINOR, by design)** reading `Get-NetNeighbor` costs one PowerShell start per sweep
  (≈ 1 s on the dev PC, 20 s timeout); a failure logs once and the sweep goes on.

## Architect
- The IP follows the MAC (agent source → ARP → DNS → stored); each change is a replicated device
  edit with an `ip_changed` event naming its source; `seen_via` / `ip_source` stay machine-local.
- A13-01 recorded: lab PCs open no port, so there is no "agent port" probe; the check-in is it.

## Code Reviewer
- Existing AC-004-07 expectation extended with the event's `source`; no other behaviour change
  for devices without agent or neighbor data.

No open CRITICAL/MAJOR. **M27 may start.**
