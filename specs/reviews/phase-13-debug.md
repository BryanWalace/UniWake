# Phase 13 — Debug: field report on v1.4.0 (2026-10-15)

## Scheduled shutdown never runs
Trace: scheduler tick → `SqliteSchedulerRepo.enabledSchedules()` **drops every schedule with
`action <> 'wake'`** (M16 fix D-M16-01, ADR-048): the hub never acts on a shutdown at fire time,
never writes a `schedule_runs` row and logs nothing. Delivery depended only on the agenda (pull).

Agenda (pull), agent side: `Invoke-UwAnswer` rewrites `agenda.json` whenever the served version
differs; reads the whole body (`CopyTo`); a real PowerShell 5.1 agent against the staged 1.4.0
bundle stored 14 items (release smoke test). Not the cause.

Agenda, hub side: the field version `8a818e7a6864163474f01903be621320` is exactly
`sha256('{"items":[],"nextWakes":[]}')[0..32]` (computed): the hub built, for the agent's device, an
agenda that matched **no schedule at all**, wake schedules included, although those wake the PCs.
- Matching is `rowsToTarget` + `targetMatches`, the same functions the wake scheduler and manual
  shutdown use; the only agenda-specific inputs are `agendaDevice(deviceId)` (room, tags, enabled,
  flag) and the uuid filter.
- Reproductions that **do not** fail: fresh hub with a pre-existing device enrolled by MAC and
  room-targeted wake + shutdown schedules created over HTTP (14 items, 14 wakes); a database
  written by the **v1.2.0** code (worktree), migrated by the current code, tag- and room-targeted
  wake schedules + a shutdown schedule (15 items, 28 wakes).
- Conclusion: with consistent data the agenda is right; in the field the device record the agent's
  token points to is not included by the schedules' targets (e.g. a second record with the same
  hostname created at enrollment, a device moved to the code's room, or device-targeted schedules
  pointing at the other record). Cannot be proven without the field database → FR-502 shows, per
  schedule, why a machine is (not) included and flags duplicates; FR-501.2 adds the hub path so a
  correct target works even when an agent's agenda is stale.

## Online status wrong; "probe helper missed its deadline" at every start
Reproduced with the shipped helper: a batch containing an empty address
(`{"targets":["127.0.0.1",""]}`) answers `{"id":null,"error":"…hostNameOrAddress…"}`. The hub ignores
answers without a numeric id → deadline (+3 s) → "missed its deadline; restarting it" → **every
device of the batch (≤ 256) resolved dead** → wrong offline statuses; three restarts in the window
switch to the ping.exe fallback. Fix FR-503.5. Additional robustness: agent check-ins and the
neighbor table as signals, IP following the MAC (FR-503).

## Findings
- **D13-01 (CRITICAL)** no push path and no history for scheduled shutdowns → ADR-053.
- **D13-02 (CRITICAL)** one bad address poisons a whole ICMP batch → ADR-055.
- **D13-03 (MAJOR)** agenda mismatch silent → FR-502, FR-504.
- **D13-04 (MAJOR)** status relies on the stored IP (DHCP drift) → FR-503.3.
