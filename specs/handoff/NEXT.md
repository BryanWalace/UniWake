# NEXT — handoff

Atualizado: 2026-10-09 · Branch de trabalho: **`dev`** (ADR-030) · **`main` = `9d7cc31`** · **release v1.2.0 publicada**
(estável, pedida pelo dono; `releases/latest` = v1.2.0, download e SHA-256 conferidos)

## ✅ Merge feito (2026-10-09)
Antes do merge: `npm run verify` (807 testes), 23 E2E, PSScriptAnalyzer + 28 Pester, CI verde na `dev`
(`11a9bc4`) e um teste de fumaça com **dois processos reais** do hub conversando por HTTP (16/16; ele
achou e eu corrigi o anúncio do código aberto, R-M11-06). Download do README na `main`: aponta para a
**v1.0.0-rc.2**, a única release publicada (HTTP 200). `releases/latest` dá 404 enquanto só houver
pré-lançamentos; troque os botões para `releases/latest/download/UniWake-Setup.exe` quando sair uma
release estável.

## v1.2 "Modo equipe" — na `main`, aguardando seu teste em PCs reais e a decisão da tag

Feito nesta etapa (desenvolvido na `dev`, CI verde, agora também na `main`):

- **Dados prontos para sincronizar (roadmap §A, M10):** migração 004 que adapta as tabelas existentes
  **sem perder nada** (testada numa cópia de um banco populado pelo v1.0), UUID estável, `rev`,
  `updated_at`, `updated_by_instance`, tombstones, change log, `instance_id`, configurações "Somente
  neste PC" separadas, agendador pronto para eleição de executor. ADR-031..034.
- **Modo equipe (v1.2, M11–M14):** pareamento por código de 6 dígitos (SPAKE2, o código não trafega),
  chave da equipe guardada com DPAPI, sincronização TLS 1.3 na porta 47102, descoberta na rede,
  endereço fixo para outra sub-rede, conflitos resolvidos, remoção de PC com troca de chave, um único
  executor por agendamento, aviso "Agendamento não executado" com "Ligar agora", regra de firewall no
  instalador. ADR-035..041.
- **Testes de duas instâncias na mesma máquina** (pastas e portas diferentes): pareiam, sincronizam
  salas/máquinas/agendamentos nos dois sentidos, resolvem um conflito e só um executa o agendamento;
  também pelo navegador (Playwright).
- **README** reescrito (pt-BR), **formulários de issue**, `SECURITY.md`, `CONTRIBUTING.md` e menu
  **Ajuda → Relatar problema / Sugerir função** com a versão preenchida.

Não comecei a v1.3 (desligamento) nem a v1.4 (backup/migração), como você pediu.

---

## 1. O que configurar no GitHub (manual)

1. **Relato privado de vulnerabilidades** (usado pelo `SECURITY.md`): repositório → **Settings** →
   **Code security** (ou "Security") → **Private vulnerability reporting** → **Enable**.
2. **Rótulos**: em **Issues → Labels**, confira que existem `bug`, `enhancement`, `question` e
   `good first issue` (o GitHub cria por padrão) e **crie** `sync`, `wol`, `scheduler` e `installer`
   (descrições sugeridas no `CONTRIBUTING.md`).
3. **Formulários de issue e SECURITY.md já estão na `main`** (a branch padrão, de onde o GitHub lê
   `.github/ISSUE_TEMPLATE/`): confira em **Issues → New issue** que aparecem "Relatar problema",
   "Sugerir função" e "Dúvida de uso", e que não há opção de issue em branco.
4. **(Recomendado) Proteger a `main`:** **Settings → Branches → Add branch ruleset/rule** para
   `main`: exigir pull request e o CI verde antes do merge, bloquear force-push.
5. **Licença:** MIT (arquivo `LICENSE`, adicionado em 2026-10-10 a pedido do dono).
6. **Assinatura do instalador (B-001)** continua pendente: sem certificado, o SmartScreen avisa ao
   instalar.

---

## 2. Baixar o instalador (v1.2.0, publicada)

A **v1.2.0** está publicada em <https://github.com/BryanWalace/UniWake/releases/tag/v1.2.0>. O botão do
README (<https://github.com/BryanWalace/UniWake/releases/latest/download/UniWake-Setup.exe>) baixa
sempre a versão estável mais recente. Confira o arquivo com
`Get-FileHash .\UniWake-Setup.exe -Algorithm SHA256` contra o `UniWake-Setup.exe.sha256` da release.

> ⚠️ PCs que já têm o UniWake (1.0.0-rc.2) e a atualização automática ligada (padrão) instalam a
> 1.2.0 sozinhos na janela de manutenção (03:00–05:00), com backup do banco antes e volta automática
> se a versão nova não responder. O cadastro é migrado sem perdas. Para atualizar já, use
> **Saúde do sistema → Atualizar agora** (administrador) ou rode o instalador por cima.
>
> Instaladores de teste da `dev` (artefato do CI, ADR-041) agora são `1.3.0-dev.<N>`: só para testar
> trabalho ainda não publicado.

---

## 3. Como testar o Modo equipe no seu PC e no do seu colega (passo a passo)

**Antes de começar**

- Dois PCs com Windows 10/11 **na mesma rede** (chamo de **PC-A** = o seu, que já tem/terá o
  cadastro, e **PC-B** = o do colega).
- A rede de cada um precisa estar como **Domínio** ou **Privada** (não "Pública"): Configurações do
  Windows → Rede e Internet → Ethernet → Tipo de perfil de rede.
- Para o teste de agendamento: uma **sala de teste** com 1 ou 2 máquinas já preparadas (o teste envia
  Magic Packets de verdade para elas).

**Passo 1 — Instalar nos dois PCs.** Rode `UniWake-Setup.exe` (v1.2.0) como administrador no
PC-A e no PC-B. Depois confira em cada um: Firewall do Windows → Configurações avançadas → Regras de
Entrada → **"UniWake - Modo equipe"** aparece **duas vezes** (TCP e UDP, porta 47102, perfis Domínio
e Privado).

**Passo 2 — Preparar o PC-A.** Abra o UniWake no PC-A (atalho no menu Iniciar), crie o
administrador (se for instalação nova) e cadastre uma sala, duas máquinas e um agendamento. Em
**Saúde do sistema**, confira a versão `1.2.0` e anote os 8 caracteres do **Identificador
desta instalação**.

**Passo 3 — Primeiro acesso no PC-B.** Abra o UniWake no PC-B e crie um administrador qualquer: ele
é temporário, porque o PC-B vai receber os usuários do PC-A.

**Passo 4 — Gerar o código no PC-A.** PC-A → **Modo equipe** → **Gerar código de pareamento**.
Aparecem o código de 6 dígitos, o tempo restante (5 min) e o endereço do PC-A.

**Passo 5 — Entrar na equipe pelo PC-B.** PC-B → **Modo equipe** → em "Entrar em uma equipe", clique
no PC-A na lista "PCs com código aberto na rede" (ou digite o IP mostrado no PC-A) → digite o código
→ **Entrar na equipe**. Se o PC-B já tinha cadastro, aparece o aviso de substituição: digite
`SUBSTITUIR` e confirme. O PC-B volta para a tela de login: **entre com o usuário e a senha do PC-A**.

✅ Esperado: no PC-B aparecem as salas, máquinas, etiquetas e agendamentos do PC-A; em **Modo
equipe**, os dois PCs aparecem, ambos **Online**, com "Última sincronização" preenchida e
"Pendentes" = 0. (Teste também um código errado uma vez: deve aparecer "Código incorreto… 4
tentativas restantes".)

**Passo 6 — Sincronização nos dois sentidos.**
- No PC-B, crie a sala "Teste B". Em até ~5 segundos ela aparece no PC-A (atualize a página).
- No PC-A, edite o nome de uma máquina; confira no PC-B.
- No PC-B, exclua uma etiqueta; ela some no PC-A.

**Passo 7 — "Somente neste PC".** No PC-B, em **Configurações**, altere **Placas de rede usadas**
(marcada "Somente neste PC") e **Repetições de cada pacote** (sem a marca: vale para a equipe).
✅ No PC-A, só a segunda mudança aparece.

**Passo 8 — Conflito.** Tire o cabo de rede do PC-B (o painel dele continua abrindo, é local).
Renomeie a **mesma sala** no PC-A ("Lab Azul") e no PC-B ("Lab Verde"). Recoloque o cabo e clique
**Sincronizar agora** nos dois. ✅ Os dois mostram o mesmo nome, e **Modo equipe → Conflitos
resolvidos** lista o nome descartado.

**Passo 9 — Agendamento com os dois ligados.** Crie um agendamento para a **sala de teste** daqui a
3–4 minutos (dia de hoje marcado). Deixe os dois PCs ligados e com o UniWake aberto ou não (é um
serviço). ✅ As máquinas ligam **uma vez**; em **Agendamentos → Execuções dos agendamentos**, os dois
PCs mostram a mesma execução; no PC que não executou, a coluna "Ligação" diz **"no PC <nome>"**; em
**Histórico**, a ligação aparece só no PC que executou.

**Passo 10 — Um PC desligado.** Pare o serviço UniWake no PC-A (`services.msc`) e crie no PC-B um
agendamento para daqui a 3–4 minutos. ✅ O PC-B executa no horário, sozinho. Religue o serviço no
PC-A: a execução aparece nele depois da sincronização.

**Passo 11 — PC que liga atrasado.** Pare o serviço nos **dois** PCs, deixe passar o horário de um
agendamento de teste e, até 15 minutos depois, inicie o serviço só no PC-B. ✅ Nada liga sozinho;
depois de ~1 minuto o painel do PC-B mostra **"Agendamento não executado"** com **Ligar agora** (que
liga a sala) e **Ciente**.

**Passo 12 — (se houver) PC em outra sub-rede.** Em **Modo equipe**, clique em **Editar** no outro
PC e informe o **Endereço fixo** (nome do computador ou IP). Os anúncios automáticos não atravessam
roteadores; o endereço fixo sim (se a porta 47102 estiver liberada entre as redes).

**Passo 13 — Remover um PC da equipe.** No PC-A, **Modo equipe → Remover da equipe** no PC-B. ✅ O
PC-B aparece como **Removido** no PC-A; na próxima tentativa de sincronizar (até ~30 s), o PC-B mostra
o aviso "Este PC foi removido do Modo equipe…" e para de sincronizar, mantendo o cadastro que já
tinha. Para continuar testando, pareie de novo (passos 4–5).

**Se algo der errado**, me mande: o horário, o passo, um print da página **Modo equipe** dos dois PCs
e os logs dos dois (**Logs → Baixar**, como administrador; ficam em `C:\ProgramData\UniWake\logs`).
Troque IPs/nomes reais se for postar em algum lugar público.

---

## 4. Release

**v1.2.0 publicada em 2026-10-09** (tag na `main` `9d7cc31`, notas em `specs/releases/v1.2.0.md`). Os
botões do README já usam `releases/latest/download/UniWake-Setup.exe`.

### Histórico da decisão

A `dev` já está na `main`. **Tag só se você pedir** (ela publica a release e dispara a atualização
automática nos PCs).

Decisão sua antes da tag: publicar direto a **v1.2.0** (inclui tudo da 1.0 e 1.1) — recomendo — ou
fechar antes a v1.0.0 a partir do `main` atual. Depois da release, eu atualizo os botões de download
do README (hoje apontam para a v1.0.0-rc.2) para `releases/latest/download/UniWake-Setup.exe`.

Itens antigos que continuam valendo: checklist de hardware do v1.0 em `specs/validation.md` (V-T05:
WoL real por modelo de PC, reinício sem ninguém logado, VLANs, HTTPS na rede) e B-001 (assinatura).

---

## Agent notes (English)

### Current state
- Branch `dev`, ahead of `main` (`7297341`). v1.0/v1.1 (M1–M9, Phase 5), M10 (sync-ready data),
  Phase 6/7 specs, M11–M15 and Phase 8 (`specs/validation.md` §v1.2, `specs/reviews/v1.2-final.md`)
  are done. Owner instruction of 2026-10-09: build v1.2 + README + community files, then STOP. Do not
  start v1.3/v1.4 until the owner says so. Never merge into `main` or tag unless asked (ADR-030).
- Team mode lives in `apps/server/src/application/team/*`, `adapters/sync-network.ts`,
  `adapters/secret-protector.ts`, `db/sync/*`, `db/repositories/team-repo.ts`,
  `apps/web/src/features/team/*`; tests `apps/server/test/team-*.test.ts`, `sync-*.test.ts`,
  `e2e/team.spec.ts`.
- CI on `dev` uploads the test installer artifact `UniWake-Setup-dev` (ADR-041,
  `DEV_VERSION_BASE` in `ci.yml`; bump it when v1.3 work starts).

### Next steps (only after the owner replies)
1. Fix whatever the two-PC checklist finds (tests first).
2. Done 2026-10-09: `main` = `52bdd85` (merge of `dev`). Next merges the same way, only on the
   owner's explicit request. Tag only if asked.
3. After a release: README download buttons → `releases/latest/download/UniWake-Setup.exe`.
4. Then v1.3 (roadmap §C: agent + shutdown, starting with the ADR comparing WMI/WinRM/Task
   Scheduler/agent) → v1.4 (§D), each through the full SDD loop.

### Working conventions
- Commit via the verify-gated helper (scratchpad `commit-task.sh <TASK|-> <msg-file>`: prettier →
  mark task → `npm run verify` → `npm run test:ps` when a .ps1 changed → staged gitleaks scan →
  commit → push **origin dev** → prints the last CI result; refuses any branch but `dev`). Recreate it
  from this description if the scratchpad is gone; gitleaks lives in `.tools/gitleaks/`.
- In this environment bash heredocs with quotes/backticks/backslashes are unreliable: write scripts
  with the editor tool into the scratchpad and run them with node.
- Every API test harness (and the monitor/retention/scheduler/team suites) runs `verifyChangeLog`
  on close: fixtures that write replicated rows with raw SQL must `changeLog(db).touch(...)` them or
  call `baselineChangeLog(db)`.
- A new migration needs `backups.test.ts` "pre-migration backup" to undo the newest one
  (`UNDO_LATEST`).
- Team tests use only 127.0.0.1 (`syncBind`, announce targets); never broadcast on the real LAN.
- Fake secrets in tests must be low-entropy (`token-de-teste-aaaaaaaa`): CI runs gitleaks.
- PowerShell files: UTF-8 BOM + CRLF (git stores LF, `.gitattributes`); PSUseSingularNouns applies.
- R-M14-02 fixed: server tests run in worker threads (forked workers crashed with 0xC0000409 on
  Windows). README screenshots are the owner's own photos with network data covered by solid boxes
  (names, IPs, MACs, enrollment command); check any new picture the same way before committing.
- The GitHub API allows 60 unauthenticated requests/hour: poll CI sparingly.
