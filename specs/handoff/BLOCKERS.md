# UniWake — Blockers needing the owner

Items here cannot be done by the agent. Work continues around each one.
Status: open · resolved.

| ID | Date | Blocker | Why the agent can't do it | Impact while open | Owner action | Status |
|---|---|---|---|---|---|---|
| B-001 | 2026-10-04 | Authenticode code-signing certificate for `UniWake-Setup.exe` | Requires buying/issuing a certificate tied to a legal identity, and storing it as a GitHub Actions secret. | Installer is unsigned: Windows SmartScreen warns on manual install and Defender may flag it. Updater verifies SHA-256 (integrity) but cannot verify authorship (ADR-009). | Get a code-signing certificate (OV/EV, or Azure Trusted Signing), add it as repo secrets (names will be documented in `plan.md`). Or accept unsigned releases for v1.0. | open |
| B-002 | 2026-10-04 | Physical validation on real hardware | Needs hands on target PCs: enable WoL in BIOS, run `prepare-target.ps1`, power off and wake. Automated tests never send real packets. | v1.0 is validated with fakes and a local fake release server only; real-world WoL success is unproven until tested. | Per `00-LEIA-ME.md`: enable WoL in BIOS on each machine and run `prepare-target.ps1`. Report any failure back (diagnostics page will help). | open |
| B-003 | 2026-10-04 | Cross-VLAN delivery of magic packets | Requires router/switch configuration (directed broadcast or IP helper / UDP forwarding) by the college network team, and knowledge of the VLAN layout. | Targets in VLANs different from the controller will not wake until the network forwards the packets (or the roadmap relay agent exists). | Tell us which rooms are on which subnets/VLANs; ask the network team about directed broadcast / UDP helper for ports 7/9. | open |

## Informational (not blocking)
- Inno Setup, `gh` CLI and Go are not installed on the dev machine. Installer builds will run on
  GitHub's Windows runners (the workflow installs Inno Setup via Chocolatey if the image lacks
  it); the agent may install Inno Setup locally in user space if needed for testing.
- Git push to `origin dev` works with the owner's stored credentials (verified 2026-10-08; `main` is off-limits, ADR-030).
