# M11 review — Code Reviewer (team core: pairing, keys, membership)

Reviewed: commits 37c595a, a5413ab + break-it fixes · Date: 2026-10-09
Lens: the new LAN surface (port 47102), cryptography use, secrets at rest.

## Break-it pass (M11-D, Debug)
| # | Probe | Result |
|---|---|---|
| 1 | Wrong code ×4, then locked; right code after lock; expired code; second code; reused code | AC-201-01 test: wrong → 4 left…, 5th → locked; afterwards NO_CODE; expired after 5 min; single use. |
| 2 | Code digits on the wire | Tapped network records every pairing/sync/announce message: neither the right nor the wrong code appears (AC-201-02). SPAKE2 messages are 256-byte group elements. |
| 3 | Garbage, invalid JSON, oversized lines, a joiner that says hello and disappears | Code stays open with 5 attempts; the next real joiner pairs (regression "garbage and a connection dropped…"). |
| 4 | Pairing while already in a team; pairing with no code open | TEAM_ALREADY_MEMBER / TEAM_PAIRING_NO_CODE, nothing stored. |
| 5 | Secrets at rest | Team row holds only protector blobs (AC-201-04); real DPAPI LocalMachine round trip on Windows (dev PC and Windows CI). |
| 6 | Element validation | Out-of-range, order-2 and non-residue elements refused; property test: any other code fails confirmation on both sides. |

## Findings
- **R-M11-01 (MAJOR, fixed while building)** The first DPAPI script failed on real Windows: double
  quotes are stripped on the way to `powershell.exe -Command` and joining lines produced `; else`.
  Now `-EncodedCommand` (UTF-16LE base64) with the data on stdin; caught by the real-DPAPI test.
- **R-M11-02 (MINOR, fixed)** The per-IP pairing rate-limit map was never pruned.
- **R-M11-03 (MINOR, accepted)** A host on the LAN can hold an open code "busy" for up to 15 s per
  step (one exchange at a time); limited to 10 connections/min/IP. Pairing is attended (5-min code).
- **R-M11-04 (MINOR, accepted, ADR-038)** Members see each other's member secret during `hello`;
  insiders already hold the team key.
- **R-M11-05 (INFO)** SPAKE2 costs ~60 ms of CPU on the main thread per exchange (2048-bit
  modexp); acceptable for a manual, rate-limited action.

No open CRITICAL/MAJOR.
