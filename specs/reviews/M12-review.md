# M12 review — Code Reviewer (sync engine)

Reviewed: commits 37c595a, a5413ab + break-it fixes · Date: 2026-10-09
Lens: convergence, idempotency, crash safety, what leaves the PC.

## Break-it pass (M12-D, Debug)
| # | Probe | Result |
|---|---|---|
| 1 | Team suites 3× in a row (two/three real hubs, services, apply, sockets) | 36/36 each time. |
| 2 | Failure mid-batch | One transaction: nothing applied (AC-202-02). |
| 3 | Same batch twice; same version from two peers | Second application changes nothing (echo = equal (rev, instance)). |
| 4 | Three PCs, A never talks to C | A's change reaches C through B with A's revision and instance. |
| 5 | Concurrent edits, duplicate MAC/name/code/username | Same result on every PC; conflicts recorded (AC-203-01..03). |
| 6 | Stale copy through a third PC after a delete | Tombstone wins; no resurrection (AC-202-05). |
| 7 | Machine settings forged into a batch | Ignored (AC-202-06). |
| 8 | Revocation with a PC off; revoked PC pulling | Off PC receives the new key on contact; revoked PC refused at TLS (AC-201-05, AC-202-04). |
| 9 | 2 000-device first sync | Applied in one transaction in well under 1 s on the dev PC. |
| 10 | 40 spoofed pairing announcements | Discovered list capped at 20. |

## Findings
- **R-M12-01 (MAJOR, fixed while building)** Acknowledgements only travelled with the next pull, so
  "pending" never reached zero and tombstones were never prunable. Explicit `ack {seq}` after a
  batch; `pull since` never lowers an ack.
- **R-M12-02 (MINOR, fixed)** The discovered-pairing list grew with every spoofed announcement.
- **R-M12-03 (MINOR, fixed)** The UDP socket ignored the bind address (tests now stay on loopback).
- **R-M12-04 (MINOR, accepted)** A spoofed announcement can point a peer at a wrong address until the
  next genuine one (15 s): TLS-PSK keeps data out; only that round of sync is lost.
- **R-M12-05 (INFO)** `changes` carries the whole log after the cursor in one message (64 MB cap) so
  references never span batches (plan §14.5).

No open CRITICAL/MAJOR.
