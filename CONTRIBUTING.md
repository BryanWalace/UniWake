# Como contribuir

Obrigado por querer melhorar o UniWake! Este guia explica como rodar o projeto, o fluxo de branches,
os testes e o padrão de commits.

## Rodar localmente

Requisitos: Windows 10/11 (recomendado; Linux/macOS funcionam para o painel e a maior parte dos
testes), **Node.js 24** e npm 11.

```powershell
git clone https://github.com/BryanWalace/UniWake.git
cd UniWake
git switch dev
npm ci
npm run dev        # hub em modo demonstração + painel com recarga automática
```

Abra <http://127.0.0.1:5173>. O modo demonstração cria salas e máquinas de exemplo e **nunca envia
pacotes reais** (simulação). Para recomeçar do zero, apague a pasta `.dev-data`.

## Branches

- Todo trabalho vai para a branch **`dev`**. Crie sua branch a partir de `dev` e abra o pull request
  **para `dev`**.
- `main` só recebe `dev` quando o mantenedor decide publicar uma versão. Não abra PR para `main`.
- Tags `v*` publicam versões e disparam a atualização automática nos PCs das instituições: só o
  mantenedor cria tags.

## Testes

```powershell
npm run verify     # lint, formatação, tipos, testes (cobertura), desempenho, dependências, rastreabilidade
npm run e2e        # testes no navegador (Playwright, Chromium)
npm run test:ps    # PSScriptAnalyzer + Pester dos scripts PowerShell (Windows)
```

O CI roda tudo isso em cada push e pull request para `dev`. Regras importantes:

- **Nenhum teste pode enviar Magic Packets reais, desligar máquinas ou varrer a rede de verdade.**
  Use os fakes de `apps/server/test/fakes` e o modo demonstração; sockets de teste só em `127.0.0.1`.
- Testes que provam um critério de aceite levam o ID no título (`it('AC-202-01 ...')`).
- Dados falsos de teste com baixa entropia (`token-de-teste-aaaaaaaa`): o CI roda o gitleaks.
- Toda escrita em dados replicados passa por um repositório que registra o change log (ADR-031);
  os testes de API verificam isso automaticamente.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) em inglês, no imperativo, até 72
caracteres:

```
feat(M12-T03): sync service pulls from every online peer
fix(scheduler): keep deferred runs until their record arrives
docs(readme): explain the firewall port for Modo equipe
```

Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `build`, `perf`. Código, specs e
commits em inglês; interface, mensagens de erro e README em português do Brasil.

## Onde ficam as decisões

`specs/` guarda a especificação (`spec.md`), o plano técnico (`plan.md`), as tarefas (`tasks.md`) e as
decisões de arquitetura (`decisions.md`, ADRs). Mudanças de comportamento começam atualizando a spec.

## Rótulos (labels)

| Rótulo | Uso |
|---|---|
| `bug` | Algo não funciona como deveria (formulário “Relatar problema”). |
| `enhancement` | Sugestão de função ou melhoria (formulário “Sugerir função”). |
| `question` | Dúvida de uso. |
| `sync` | Modo equipe: pareamento, sincronização, conflitos. |
| `wol` | Wake-on-LAN: pacotes, placas de rede, VLAN/broadcast, BIOS. |
| `scheduler` | Agendamentos, exceções, pausa, resultado da manhã. |
| `installer` | Instalador, serviço do Windows, atualização automática, firewall. |
| `good first issue` | Boa para quem está começando no projeto. |

## Segurança

Vulnerabilidades **não** devem virar issue pública: veja o [SECURITY.md](SECURITY.md).
