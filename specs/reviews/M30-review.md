# M30 review — Sleeping and hibernated machines (v1.6.0)

Date: 2026-10-17 · Scope: M30-T01..T03 · agent (`Get-UwResume`, `Get-UwSleepKind`,
`Get-UwHibernateInfo`, `Invoke-UwSleepPolicy`, `Set-UwSleepTimeout`), contract (`health.power`,
answer `power.preventSleep`), `power-orders.ts` (wake asleep), settings `power.wakeForShutdown` /
`power.preventSleep`, device page and manual dialog.

## Debug
- The owner's question answered in code: a hibernated PC runs nothing, so it must be woken first.
  Agenda items already wake it with "UniWake Despertar" (ADR-045); orders now get a magic packet for
  ready machines that stopped answering while seen in the last 12 h (AC-605-02, manual and pushed,
  setting off → none, restart → none).
- A resume is a gap without a restart (boot before the last heartbeat); kind from Kernel-Power 42
  TargetState 5/2..4. **D-M30-01 (MINOR, não verificado)** the TargetState values are taken from
  `SYSTEM_POWER_STATE`; on unknown values the panel says "suspensa ou hibernada".
- Found while testing: a wake schedule shortly after a push sees the "acordar para desligar" wake job
  still verifying and takes it as its result (the M5-F2 rule). Harmless; a test PC that just checked
  in now counts as online in that test, as the monitor would see it (ADR-055).

## Architect
- "Impedir suspensão e hibernação" is opt-in (owner, 2026-10-17); the agent keeps the old values once
  and re-applies after a frozen restart without overwriting them (AC-605-03). AC only.
- The wake uses the normal "Ligar" path (`source: manual`, actor "acordar para desligar (…)"): no new
  job source, so no table rebuild of `wake_jobs`' CHECK constraint.
- `agent_health.power_json` went into migration 009, which no release contains yet.

## Code Reviewer
- All powercfg calls go through the `Set-UwSleepTimeout` wrapper, mocked in every test; the system
  wrapper list is complete (asserted). The preview tells how many offline machines will be woken.

No open CRITICAL/MAJOR. **Phase 16 (validation) may start.**
