# M13 review — Code Reviewer (team scheduling)

Reviewed: TeamLease, scheduler deferral and missed runs · Date: 2026-10-09

- Election is deterministic and message-free (ADR-039): AC-204-01 with two real hubs gives exactly
  one job; AC-204-02 (elected PC off) runs on time; AC-204-03 (elected PC on but stuck) runs once
  between 90 s and the next tick; AC-204-04 offers the missed run and wakes only on "Ligar agora".
- Deferred occurrences are in memory: a restart drops them, which is the FR-204.2 path (offered).
- **R-M13-01 (MINOR, accepted)** A split view (A sees B, B does not see A) can run a schedule twice;
  never zero times. Documented in README FAQ.
- **R-M13-02 (MINOR, accepted)** A team PC that restarts inside the grace window offers the run
  instead of running it even if it is the only member online: another PC may have run it, and the
  owner chose "offer, not auto-run" (roadmap §B).
- **R-M13-03 (INFO)** Synced runs show "no PC <nome>" instead of a job link (the job lives there).

No open CRITICAL/MAJOR.
