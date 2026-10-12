# M18 review — Lab-PC scripts (v1.3)

Date: 2026-10-11 · Scope: M18-T01..T06, M18-D · `scripts/agent/uniwake-agent.ps1`,
`scripts/agent/uniwake-aviso.ps1`, `scripts/prepare-target.ps1` (step 8) · 81 Pester tests.

## Security review (scripts run as SYSTEM on lab PCs)
| Guarantee | How |
|---|---|
| SYSTEM runs only files administrators own | Agent folder taken over and locked (owner Administrators, protected ACL); the agent checks owner and ACL before every run and refuses otherwise (exit 3). |
| Nothing from the network is trusted unsigned | Enrollment answer and every check-in answer verified with the pinned key over the request's nonce; scripts accepted only on the signed SHA-256; forged, replayed or untrusted-key answers are ignored entirely. |
| Users cannot steer SYSTEM through files | The users' answers folder is only read by SYSTEM (never written or deleted there), links and files over 4 KB skipped, at most the 50 newest read, one count per response id, limits enforced by SYSTEM. |
| No secrets where users can read | Token and config in the Administrators/SYSTEM folder; the request file users read holds only the message and times. |
| No inbound surface | Outbound HTTP only; no port opened on lab PCs. |
| Nothing hidden | Plain scripts, no `-EncodedCommand`, no obfuscation (RK-24). |
| LGPD | `quser` lines are counted, never parsed for names; the strict hub contract refuses extra fields. |

## Debug break-it (M18-D)
- **D-M18-01 (CRITICAL, fixed)** The persistent folder (`-PersistentPath`, e.g. a ThawSpace) can be
  writable by users; SYSTEM writes the agenda there through a temporary file + move, so a planted
  junction or link would redirect a SYSTEM write anywhere (privilege escalation). → the preparation
  locks the folder like the agent folder (`Protect-UwFolder`), and the agent uses it only if it
  passes the same owner/ACL check, else falls back to its own folder (`agent-breakit` tests).
- **D-M18-02 (MINOR, fixed)** A flood of files in the users' answers folder was read in full every
  2 s during a warning. → only the 50 newest.
- Tampered and half-written agenda/state files → nothing runs, never a shutdown; report queue capped
  at 500 (oldest dropped); unprepared PC → exit 2; a run interrupted during the warning never
  repeats the item (marked before running).

## Bugs the tests found while building (all fixed before commit)
- **(MAJOR)** The report queue was returned as one object, so `@(...)` nested it: every check-in
  with queued reports would have sent `reports: [[…]]` and been refused by the hub.
- **(MAJOR)** `GetNewClosure()` ran the check-in builder and the poll in another module without the
  script's functions: every real check-in would have failed.
- **(MINOR)** Under StrictMode a missing hashtable key throws: the freezing classifier now reads
  facts through `ContainsKey`.
- (tooling) PowerShell `$'` inside a JavaScript `replace` replacement corrupted a patch once; the
  scratch patchers now use function replacements.

## Open items (INFO)
- **R-M18-01** M18-T01 (warning window in the user's session via a group task) needs a real PC:
  on the owner's checklist (V3-T02). Fallback: native warning without "Adiar".
- **R-M18-02** Deep Freeze: `DFC.exe` location and whether `get /ISFROZEN` needs a password are
  **não verificado**; without DFC.exe the state is "detectado (estado não verificado)".
- **R-M18-03** `powercfg` values read by position: checked on Windows 11 pt-BR only.
- **R-M18-04** "UniWake Aviso" runs `powershell.exe -WindowStyle Hidden`: a brief console flash is
  accepted (ADR-046).
- **R-M18-05** The prepare step installs the tasks even on a frozen PC (they work until the next
  restart) and says ATENÇÃO; the hub's "perdido" rule flags it after the restart.

No open CRITICAL/MAJOR. **M19 may start.**
