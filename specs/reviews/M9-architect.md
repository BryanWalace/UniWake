# M9 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-06

| Plan item | Status | Note |
|---|---|---|
| Layering | ✔ | Parsers and CIDR math in `domain/` (pure), DiscoveryService in `application/` behind ports (NeighborCache, Prober, DnsResolver.reverse, NetworkInterfaces), PowerShell/arp in adapters with a bundled script (plan §9.1). |
| API (plan §6.1) | changed | `/api/discovery`, `/api/discovery/scan`, `/api/discovery/add` (operator) added; web route `/dispositivos/descobrir`. |
| Packaging | changed | `data/oui.tsv.gz` shipped in each version directory by `scripts/build.ts`. |
| Demo mode (FR-015) | ✔ | Simulated network provides unregistered machines; nothing touches the network. |

No further plan change. Phase 5 (validation) may start once the Windows CI jobs are green (M8-T12).
