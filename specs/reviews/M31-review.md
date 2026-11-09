# M31 review — A wake that insists (v1.7.0)

Date: 2026-11-08 · Scope: M31-T01..T04 · `job-runner.ts` (retry rounds, unicast, outcome log),
`domain/network.ts` (`unicastRoutes`), `relay-service.ts`, `wake-relay-repo.ts`, migration 010,
contract (`wake` in the answer, `health.relays`), `agent-service.ts` (delivery, report),
`Invoke-UwRelay` / `Send-UwMagicPacket` on the agent, job page.

## Architect
- The owner asked for "outra maneira até ligar". Research (Configuration Manager wake-up proxy, unicast
  WoL, EEE/late-arming NICs) gave three independent paths, now tried in order: the hub's broadcasts
  again (round N), a unicast to the last IP, and an awake neighbour broadcasting inside the room's own
  network. ADR-063 amends constitution §2.6 for the last two.
- The neighbour path keeps the pull model and the signatures (ADR-042/044): the hub only adds MACs to
  an answer the agent verifies; the agent sends nothing but a 102-byte magic packet. No new listener,
  no new port, nothing executed from the answer.
- Everything new is machine-local (packet log columns, `wake_relays`), so a team hub that did not
  start the job never relays for it and nothing changes in sync.

## Debug
- **D-M31-01 (MAJOR, fixed before merge)** the first version of the 500-device scale test counted
  6000 packets; with 3 retry rounds a room that stays off sends 4× more. The test now pins round 0
  (its purpose), and AC-701-01 covers the rounds. Cost bounded: each round sends only to machines still
  waiting, staggered as the first.
- **D-M31-02 (MINOR)** after a hub restart the resumed verification starts its round counter again,
  so a job interrupted mid-window may get up to 3 more rounds. Harmless (only waiting machines).
- The verification window guard (M3-F1) adds the time spent inside a round, so a big round cannot
  stretch the window past `verifyWindowMinutes`.
- A relay report re-sent after a lost answer is logged once (`hasRelayPacket`); a report for a MAC the
  hub never asked that PC about is ignored (`match` by relay PC + MAC + delivery time ± 10 min).

## Code Reviewer
- Dry-run and demo never ask neighbours (asserted). `wake.macs` accepts canonical MACs only, at most
  50 per answer; ports 1–65535, at most 4. The agent re-validates every MAC before sending.
- `Send-UwMagicPacket` is a system wrapper (asserts the real system, faked in every Pester test; the
  wrapper list test is updated). No test sends a real packet.
- Packet table: "Tentativa" column and "PC (vizinha, IP)" for relayed rows (web test).

No open CRITICAL/MAJOR.
