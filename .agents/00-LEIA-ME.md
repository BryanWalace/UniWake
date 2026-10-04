# UniWake — Kit de agentes (SDD)

Repositório: https://github.com/BryanWalace/UniWake

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `01-project-brief.md` | Contexto e escopo do produto. Todos os agentes leem primeiro. |
| `02-architect.md` | Papel Architect |
| `03-senior-fullstack.md` | Papel Senior Fullstack Developer |
| `04-debug-problem-solver.md` | Papel Debug & Problem Solver |
| `05-code-reviewer.md` | Papel Code Reviewer |
| `06-orchestrator.md` | Modo totalmente automático: um único agente executa os 4 papéis em sequência |

## Como usar

**Modo A — automático (recomendado para rodar sem autorização):**
copie `01` a `05` para a pasta `.agents/` do repositório e mande ao agente apenas o
conteúdo de `06-orchestrator.md`. Ele executa todas as fases trocando de papel sozinho.

**Modo B — manual, um agente por papel no VS Code:**
use cada arquivo `02` a `05` como instrução do agente correspondente. Ao final de cada
etapa o agente escreve em `specs/handoff/NEXT.md` qual papel deve rodar em seguida; você
só troca de agente e diz "continue".

## Fluxo de fases

| Fase | Lidera | Revisam / contribuem |
|---|---|---|
| 0. Constitution | Architect | Fullstack, Debug, Reviewer |
| 1. Specify | Architect | Fullstack, Debug, Reviewer |
| 2. Plan | Architect | Fullstack, Debug, Reviewer |
| 3. Tasks | Senior Fullstack | Architect, Reviewer |
| 4. Implement (por marco) | Senior Fullstack | Debug (falhas), Reviewer (revisão do marco) |
| 5. Validate | Debug | Reviewer (auditoria), Architect (aprova release) |

Em cada fase **todos os papéis pensam individualmente** e registram sua visão em
`specs/reviews/phase-<N>-<papel>.md` antes de o líder consolidar. Melhorias propostas
por qualquer papel vão para `specs/improvements.md` e o Architect decide.

## O que só você pode fazer
1. Garantir que o repositório existe e o agente tem permissão de push.
2. Ir máquina por máquina: ativar WoL na BIOS e rodar o `prepare-target.ps1` (que também
   cadastra a máquina na sala certa automaticamente).
3. Criar a tag `v1.0.0` quando quiser publicar a primeira release (ou deixar o agente criar).
