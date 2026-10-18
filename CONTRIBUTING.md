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

O CI roda tudo isso em cada push (para `dev` e `main`) e em cada pull request. Regras importantes:

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

## Pull requests

O modelo do pull request traz uma lista de conferência. O essencial:

1. Abra para a branch **`dev`**, com uma descrição do que muda e de como foi testado.
2. `npm run verify` verde (e `npm run test:ps` se mexeu em PowerShell).
3. **Documentação junto com o código**: o que muda para quem usa vai no README (pt-BR) e na seção
   "Não publicado" do [CHANGELOG.md](CHANGELOG.md); mudanças no que é seguro ou não vão no
   [SECURITY.md](SECURITY.md); mudanças no fluxo de trabalho, neste arquivo. O `npm run verify`
   confere se os documentos existem e se o roadmap e o histórico citam a versão mais recente.

## Publicar uma versão (mantenedor)

1. Notas em pt-BR em `specs/releases/vX.Y.Z.md`; a seção "Não publicado" do CHANGELOG vira
   `## [X.Y.Z] — data`; README (roadmap, novidades, funcionalidades) e a tabela de versões do
   SECURITY atualizados.
2. Merge de `dev` em `main` com o CI verde nas duas.
3. Tag anotada `vX.Y.Z` na `main`: o workflow de release confere tudo de novo (inclusive a
   documentação), gera o instalador com o SHA-256 e publica. Os PCs se atualizam sozinhos na janela
   de manutenção.

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
| `shutdown` | Desligar e reiniciar, aviso na tela, agente das máquinas, antivírus, hibernação. |
| `documentation` | README, ajuda do painel, CHANGELOG e demais documentos. |
| `good first issue` | Boa para quem está começando no projeto. |

## Segurança e conduta

Vulnerabilidades **não** devem virar issue pública: veja o [SECURITY.md](SECURITY.md). Todos os
espaços do projeto seguem o [código de conduta](CODE_OF_CONDUCT.md).
