# M16 review — Foundations: signing, data, contracts (v1.3)

Date: 2026-10-11 · Scope: M16-T01..T05, M16-D · Commits `aa48649`..`804028f` + M16-D fix commits.

## Debug break-it (M16-D)
| # | Check | Result |
|---|---|---|
| 1 | Full suite 3× | **Failed** → R-M16-01 (native crash), D-M16-02 (flaky assertion). |
| 2 | Kill mid-operation | Migration 006 runs in one transaction (`migrate`); the start-up baseline re-logs rows left at rev 0 on the next start. Hub key: the row is written after the key exists; a crash before leaves no row → a new key next start (no machine prepared yet). |
| 3 | Max/malformed input | Strict Zod contract (M16-T04 tests: extra fields, out-of-window items, caps). |
| 4 | Fake port failing | Protector failing to open → key retired and replaced (M16-T02 test). |
| 5 | Clock ±1 h, midnight, DST | `breakit-m16.test.ts`: agenda is a pure function of `now`; midnight; New York fall-back/spring-forward. |
| 6 | Same action twice in parallel | **Failed** → D-M16-03 (two active keys). |
| 7 | Logs without secrets | Only the key id is logged; the private key never leaves the protector. |

## Findings
- **D-M16-01 (CRITICAL, fixed)** The scheduler executed every enabled schedule. A "Desligar" schedule
  (from a team peer today, from the API in M17) would have made the hub **wake** the labs at
  shutdown time. → `SqliteSchedulerRepo.enabledSchedules` returns only `action = 'wake'`;
  regression test fails without the fix (`breakit-m16.test.ts`). M17-T04 keeps the AC-306-01 part
  about agendas.
- **D-M16-02 (MINOR, fixed)** A hub-key test asserted that random ciphertext never contains the
  bytes `30 82` (fails ~2.6% of runs). → asserts that the blob opens to the key and holds no 64-byte
  run of it.
- **D-M16-03 (MAJOR, fixed)** Two `HubKeyService.init()` calls at once could insert two active keys
  (then different keys after restarts). → calls share one in-flight promise; test.
- **D-M16-04 (MAJOR, fixed — constitution §5)** On Windows, hub tests (`hub.test.ts`,
  `team-two-instances.test.ts`) ran the real `ping.exe` against `10.x` device addresses through the
  monitor: real ICMP on the developer's LAN. → the test guard also wraps `child_process` (spawn,
  execFile and sync variants, re-synced for ESM named imports): `ping.exe` to non-loopback hosts
  and any `shutdown.exe` throw. Tests prove both, also through named imports.
- **R-M16-01 (MINOR, open — test infrastructure)** Native crash 0xC0000409 of a Vitest worker on
  the Windows dev PC in ~10–17% of full runs (R-M14-02 was the same crash). Under `pool: 'threads'`
  it killed the **whole** run silently (Git Bash exit 127 = 0xC0000409, nothing printed); that is
  why three helper runs this session stopped after "Coverage enabled". Evidence:
  - only when several server test files run at once, always including team-socket files
    (`team-*`, `power-migration` protocol tests, `hub.test.ts`); 0/25 with the team or sync group
    alone;
  - not reproducible outside Vitest: 7 200 TLS 1.3 PSK sessions through the real
    `NodeSyncNetwork` in 4 parallel processes, 2 880 concurrent child processes (ping, PowerShell,
    with kills), 1 200 worker threads leaving `node:sqlite` databases open — 0 crashes;
  - never seen on the CI Windows runner since R-M14-02.
  Mitigation: server tests back on `forks` (the crash fails one **named** file instead of the whole
  run); the commit helper reruns `verify` once only for this signature and says so. Product risk
  judged low (the hub is one process with one isolate; none of the stress tests crashed), but
  real-PC tests of Modo equipe should watch for hub restarts in the service log.
- **R-M16-02 (INFO)** Pairing a v1.3 PC with a v1.2 PC fails with the generic pairing error (the
  v1.2 side cannot be changed). Mixed versions are not supported (ADR-048); the help page will say
  "atualize os dois PCs" (M20-T01).
- **R-M16-03 (INFO, for M17-T06)** `device_agents`, `power_orders` and `power_reports` cascade on
  device delete; when they become replicated entities the device delete path must tombstone them
  first (as rooms/tags do for references).
- **R-M16-04 (INFO)** The agenda generator falls back to 5 min / 2× 15 min when a shutdown schedule
  has NULL policy columns; M17-T04 must always store explicit values on create/update.

## Review notes (Code Reviewer)
- Layering holds: `domain/agenda.ts` stays pure (the digest is injected); `node:crypto` only in
  application/adapters; `hub_keys` stays machine-local and out of backups' replicated data.
- The contract refuses unknown fields everywhere, which is what enforces "no user names" (Q-6).
- Spec/ADR updates made during M16: window look-back 6 h (FR-303.1, ADR-045), key id = RFC 7638
  thumbprint (ADR-044), `-HubKeyId` reaches the one-liner in M18-T05.

No open CRITICAL/MAJOR. **M17 may start.**
