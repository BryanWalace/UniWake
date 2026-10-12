# Phase 9 review — Code Reviewer

Date: 2026-10-11 · Lens: consistency, traceability, rules.

- **R9-01** Every AC of FR-301..311 is referenced by a task; `npm run check:trace` passes
  (M16–M20 not done yet, so no test titles are required).
- **R9-02** Constitution changes are named by ADRs (§2.6, §5, §6.1, new §6.3a by ADR-042/043), per
  §11. Plan §6.2 "exactly three routes" amended to five (ADR-043).
- **R9-03** No invented commands or exit codes: ADR-047 marks each freeze-product method with its
  source and "não verificado" where only third-party sources or nothing exist; ADR-045/046 do the
  same for wake-timer defaults, Modern Standby, `conhost --headless` and the group-principal task.
- **R9-04** The owner asked for "Ação: Ligar | Desligar"; scheduled restart was removed from FR-306
  and turned into Q-10 instead of being added silently.
- **R9-05** Text shown to users (warning, ATENÇÃO instruction, readiness labels) is in pt-BR; specs
  stay in English.
- **R9-06** Test safety: constitution §5 now forbids real `shutdown.exe`, real task registration
  and power-plan changes in tests; wrappers + guard (plan §15.2).
- **R9-07** RM-2 replaced by §6b; roadmap paragraph updated; RM-7 added for product integrations;
  §10 notes RM-5's v1.3 decision.

No open findings. Waiting for owner approval and Q-1..Q-10.
