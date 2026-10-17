# M29 review — Agent update that works and tells; antivirus (v1.6.0)

Date: 2026-10-17 · Scope: M29-T01..T05 · contract (`agent/checkin.ts`: `health`, `features`,
`agentAlertSchema`), migration 009, `agent-service.ts`, `agent-health.ts`, `power-status.ts`,
`notices-service.ts`, `health-service.ts`, `routes/agent.ts`; agent 1.7.0 (`uniwake-agent.ps1`:
verified self-update, health state, self-install, repair command, antivirus); panel pages.

## Debug
- Self-update outcomes are proven per path in Pester (written and read back, 225 from a real
  `IOException`, file removed by a fake scanner during the wait, download/hash failures).
- The repair command is executed for real by Pester in a temporary folder (restore, changed file,
  copy gone → note + alert to a closed loopback port within 30 s). A CI-only test registers the real
  "UniWake Reparo" task on the disposable Windows runner (not on the owner's PC).
- **D-M29-01 (MAJOR, fixed in review)** after the antivirus was fixed and "UniWake Reparo" restored
  the file, nothing needed updating, so the last outcome stayed `write_blocked` and the machine would
  have shown "Agente bloqueado" forever. Now a past failure becomes "updated" once every file matches
  the signed hashes again (Pester).
- **D-M29-02 (MINOR, fixed in review)** a frozen machine loses the repair task at every restart, but a
  *successful* registration was throttled for an hour (health.json lives in the kept folder). Only
  failures wait now (Pester).
- **D-M29-03 (MINOR, fixed in review)** `Get-UwProp` did not read `[ordered]` dictionaries the agent
  builds itself (only hashtables and JSON objects); now any `IDictionary`.

## Architect
- Mixed teams: `health` goes only to hubs whose answers list it; health objects drop unknown fields so
  a newer agent still checks in; the strict top level still refuses anything else (asserted).
- The repair task is an inline command on purpose (a quarantined file cannot disable it); it only
  copies bytes whose hash came from a signed answer and never runs what it receives.
- **A-M29-01 (MINOR, accepted)** the inline `powershell -Command … Invoke-WebRequest` may itself look
  suspicious to some antivirus heuristics (não verificado); the main agent already does HTTP from a
  scheduled PowerShell task, so the exposure is the same kind.
- Machines whose agent cannot run today still need one last preparation (stated in the help and in the
  owner checklist); afterwards install steps travel with the script (level 2 now).

## Senior Fullstack
- One aggregated notice (`agent_blocked`, last 30 events, deduplicated); device list marks read all
  health in one query; the device page alone gets the full health.
- New help page "Antivírus e o agente do UniWake"; UniWake never adds antivirus exclusions (ADR-060).

## Code Reviewer
- Agent listener now has six routes (plan §6.2 and both route allow-lists updated, alert route rate
  limited and token-checked like the check-in). File names only in health, never paths (LGPD).

No open CRITICAL/MAJOR. **M30 may start.**
