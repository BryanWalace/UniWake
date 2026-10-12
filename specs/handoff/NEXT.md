# NEXT — handoff

Atualizado: 2026-10-12 · Branch de trabalho: **`dev`** (ADR-030) · **`main` = `8e1b794`** · **release v1.4.0 publicada**
(estável, pedida pelo dono; `releases/latest` = v1.4.0, download e SHA-256 `7336d094…` conferidos). Inclui a v1.3 (Desligar
computadores) e a v1.4 (Backup e migração); os PCs com o UniWake se atualizam sozinhos na janela 03:00–05:00.

## Release v1.4.0 (2026-10-12)
- Antes: verify, Pester, E2E, CI verde na `dev` e na `main`, teste de fumaça no pacote montado (16/16, com check-ins reais do
  agente PowerShell 5.1 contra o hub; achou e corrigi um crash de saída da linha de comando).
- A primeira execução do workflow de release falhou nos testes do Windows (crash nativo do Vitest, R-M16-01): o `release.yml` não
  tinha o retry que o `ci.yml` tem. Corrigido; o E2E do Modo equipe também falhou uma vez no Ubuntu por porta efêmera
  (portas do E2E movidas para 271xx). A tag foi recriada em `8e1b794` (a anterior não tinha gerado release) e a publicação passou.
- Notas: `specs/releases/v1.4.0.md`.

## v1.4 "Backup e migração" — publicada na v1.4.0, aguardando seu teste em PCs reais

Feito de M21 a M24 e validado (Fase 12); publicado na v1.4.0.

- **Página "Backup e migração"** (administradores): exporta um arquivo `.uniwake` com as partes
  escolhidas (Cadastro, Agendamentos, Configurações gerais, Usuários, Desligamento remoto,
  Histórico). Usuários e Desligamento remoto só saem com senha (argon2id + AES-256-GCM).
  Configurações deste PC nunca vão no arquivo.
- **Importar** com prévia (novos, atualizados, sem mudança, conflitos, removidos), **Mesclar** ou
  **Substituir**, confirmação digitando `IMPORTAR`, backup automático antes e **Desfazer
  importação**.
- **Em espera:** depois de importar, o PC não roda agendamentos nem manda ordens às máquinas até
  você clicar em **Ativar este UniWake** (evita o PC antigo e o novo agirem ao mesmo tempo).
- **Exportação automática** diária para uma pasta (pode ser da rede) e **linha de comando**
  (`--export` / `--import`).
- **Decisões que tomei sozinho (pode mudar qualquer uma):** A-1 o arquivo é JSON compactado (gzip),
  não zip; A-2 segredos só com senha; A-3 PC em Modo equipe não importa; A-4 PC importado fica em
  espera até ativar; A-5 a exportação automática nunca leva segredos (não guardo senha). Estão nos
  ADR-049 a 052.
- Correções no caminho: "Substituir" apagaria o histórico local das máquinas (corrigido para
  atualizar no lugar); entrar numa equipe deixava pedidos de desligamento antigos para trás.

### Como testar o backup e a migração (passo a passo)

Use o PC da TI com a versão de teste `1.4.0-dev.N` (mesmo caminho do item 0 da v1.3 abaixo) e,
se puder, um segundo PC (pode ser uma máquina virtual) para o "PC novo".

**1. Exportar com senha**
1. Painel → **Backup e migração** → em **Exportar** deixe as partes marcadas, digite uma senha
   (10+ caracteres) duas vezes → **Exportar**. O navegador baixa `UniWake-<PC>-<data>.uniwake`.
2. Guarde a senha: sem ela não dá para importar Usuários e Desligamento remoto.

**2. Importar no PC novo (Substituir)**
1. Instale a mesma versão de teste no PC novo e crie o primeiro usuário.
2. **Backup e migração** → **Importar** → escolha o arquivo → digite a senha → **Substituir** →
   **Ver prévia**. Confira os números (máquinas, agendamentos).
3. Digite `IMPORTAR` → **Importar**. O painel pede login: entre com um usuário do PC antigo.
4. Esperado: salas, máquinas e agendamentos iguais; faixa vermelha "Este UniWake está em espera" em
   todas as páginas; em **Saúde do sistema** a versão certa.

**3. Em espera e ativar**
1. Confirme que nenhum agendamento roda no PC novo enquanto estiver em espera.
2. Desligue o UniWake do PC antigo (`services.msc` → UniWake → Parar).
3. No PC novo: **Backup e migração** → **Ativar este UniWake** → digite `ATIVAR`.
4. Se o PC novo tiver **outro endereço** na rede, rode de novo o comando de **Preparar máquinas**
   nas máquinas preparadas para desligar (elas guardam o endereço do PC antigo).
5. Para voltar atrás: **Desfazer importação** → digite `DESFAZER` (o serviço reinicia com o banco de
   antes).

**4. Exportação automática numa pasta da rede**
1. **Configurações → Exportação automática**: ligue, informe a pasta (ex.: `\\servidor\uniwake`),
   horário e quantos manter → **Salvar**.
2. Na pasta compartilhada, dê permissão de **gravação à conta do computador** do PC da TI (ex.:
   `DOMINIO\PC-TI$`), não ao seu usuário: o serviço roda como Sistema Local.
3. Para testar sem esperar a madrugada, ponha o horário para daqui a 2 minutos e confira o arquivo
   na pasta. Se falhar, **Saúde do sistema** mostra o motivo. **Me diga se funcionou** (isso não dá
   para testar aqui: depende da rede da instituição).

**5. Linha de comando (opcional)**
- PowerShell como Administrador, em `C:\Program Files\UniWake\versions\<versão>`:
  `& .\node.exe .\server.mjs --export D:\teste.uniwake` (funciona com o serviço rodando).

**O que me mandar:** se a prévia bateu com o que você esperava, se o login com o usuário antigo
funcionou, se a exportação automática gravou na pasta da rede, e qualquer mensagem de erro.

## v1.3 "Desligar computadores" — publicada na v1.4.0, aguardando seu teste em PCs reais
(Agora dá para usar a versão estável 1.4.0 em vez do instalador de teste do item 0.)

Tudo de M16 a M20 e a validação (Fase 10) estão prontos, com CI na `dev`:

- **Painel:** botões **Desligar** e **Reiniciar** na sala, na máquina e na seleção; resumo antes de
  confirmar (quantas recebem, quantas têm alguém usando, quais precisam do novo preparo); painel
  lateral com o andamento; **Ação: Desligar** nos agendamentos (aviso, adiamentos, etiquetas
  excluídas); "Nunca desligar por agendamento" na máquina; selo de prontidão em Dispositivos; quadro
  **Desligamento remoto** na página da máquina (com "Revogar"); desligamentos no **Histórico**;
  opções de Deep Freeze/UWF em **Preparar máquinas**; duas páginas de ajuda; README.
- **Máquinas dos laboratórios:** o comando de preparo instala três tarefas do Windows (UniWake,
  UniWake Despertar, UniWake Aviso) e scripts PowerShell simples; nada é baixado de fora, nenhuma
  porta é aberta, nenhuma senha compartilhada. Elas consultam o UniWake a cada minuto e desligam no
  horário mesmo com o PC da TI desligado.
- **Revisões e correções desta reta final:** a "Pasta persistente" aceitava pastas do Windows (o
  preparo trancaria as permissões delas) → agora recusa; `-RemoveAgent` apagaria
  `C:\ProgramData\UniWake` inteira (no PC da TI isso é o banco e os backups!) → agora remove só as
  pastas do agente; o agente tentava todos os PCs da equipe a cada minuto → no máximo 3 tentativas.
- **Medição de carga:** 500 máquinas consultando a cada minuto custam 2,4 ms por consulta no hub
  (meta: 5 ms).

Ficou para você confirmar em PCs reais (não dá para testar aqui sem desligar máquinas de verdade):
a janela de aviso aparecer na sessão do usuário (spike M18-T01), o temporizador de ativação tirar o
PC da suspensão, Deep Freeze/UWF de verdade e o tempo da tarefa com o hub desligado (NFR-302).
Itens **não verificados**: local do `DFC.exe` do Deep Freeze e se ele pede senha; `powercfg` em
Windows que não seja pt-BR; PCs com Modern Standby.

### Como testar o desligamento em PCs reais (passo a passo)

Use **um PC de laboratório de teste** (fora de aula) e o seu PC da TI. Nada disso exige programa
extra nas máquinas.

**0. Instalar a versão de teste no PC da TI**
1. GitHub → **Actions** → o último "CI" verde da branch `dev` → em **Artifacts**, baixe
   **UniWake-Setup-dev** (`UniWake-Setup-1.3.0-dev.N.exe` + `.sha256`).
2. Confira o SHA-256: `Get-FileHash .\UniWake-Setup-1.3.0-dev.N.exe` (PowerShell) e compare com o
   arquivo `.sha256`.
3. Instale por cima da 1.2.0 (um backup é feito antes). Essa versão de teste só se atualiza sozinha
   para uma release estável mais nova.
4. Abra o painel → **Saúde do sistema**: versão `1.3.0-dev.N`.

**1. Preparar o PC de teste**
1. **Preparar máquinas** → escolha a sala → **Gerar código** → **Copiar comando**.
2. No PC de teste: botão direito em Iniciar → **Terminal (Administrador)** → cole → Enter.
3. No resumo, confira: **Desligamento remoto: OK**, **Temporizadores de ativação**, **Congelamento**.
   Tire um print do resumo.
4. Abra o **Agendador de Tarefas** → Biblioteca: devem existir **UniWake**, **UniWake Despertar** e
   **UniWake Aviso**.
5. No painel, em até 1 minuto: **Dispositivos** mostra "Pronta para desligar" nessa máquina; a página
   dela mostra o quadro **Desligamento remoto** (última consulta, versão, suspensão, temporizadores).

**2. Desligar sem ninguém logado**
1. Faça logoff no PC de teste (tela de login).
2. No painel, na página da máquina: **Desligar** → confirme.
3. Esperado: desliga em ~1 min (consulta + 30 s); o painel lateral termina em **Desligou**.

**3. Desligar com alguém usando (o teste mais importante)**
1. Ligue o PC de teste (**Ligar** no painel) e entre com um usuário comum (não administrador).
2. **Desligar** → em "Aviso na tela", escolha **5 min com adiamento**.
3. Esperado: aparece a **janela do UniWake** com a mensagem, a hora e o botão **Adiar**. Clique em
   **Adiar** uma vez: o painel mostra o adiamento; depois desliga.
4. **Me diga exatamente o que apareceu.** Se em vez da janela aparecer o aviso padrão do Windows
   ("Você será desconectado…", sem Adiar), é o plano B (ADR-046) funcionando, e eu preciso ajustar a
   tarefa "UniWake Aviso" (M18-T01).
5. Repita com **Aviso: 1 min** e clique em **Cancelar o que ainda não executou** no painel lateral antes do fim: não deve
   desligar.

**4. Reiniciar**
- **Reiniciar** na página da máquina → ela reinicia e volta a aparecer como ligada.

**5. Agendamento com o PC da TI desligado**
1. **Agendamentos** → Novo → **Ação: Desligar**, a sala do PC de teste, horário daqui a ~10 min.
2. Espere 1–2 min (a máquina recebe a agenda) e **pare o UniWake**: `services.msc` → UniWake →
   Parar (ou desligue o PC da TI).
3. Esperado: no horário o PC de teste mostra o aviso e desliga sozinho.
4. Ligue o UniWake de novo, ligue o PC de teste → em até 1 min o **Histórico** mostra a ocorrência
   ("1/1 desligou").

**6. Suspensão + temporizador de ativação**
1. Crie um agendamento Desligar para daqui a ~10 min.
2. Coloque o PC de teste em **suspensão** (Iniciar → Energia → Suspender) antes do horário.
3. Esperado: ele acorda sozinho no horário e desliga. Se não acordar, me mande o que a página da
   máquina mostra em "Temporizadores de ativação" e o modelo do PC.

**7. Tempo da tarefa com o hub desligado (NFR-302)**
- Com o serviço UniWake parado, no PC de teste: Agendador de Tarefas → **UniWake** → aba
  **Histórico** (habilite em "Ativar Histórico de Todas as Tarefas" se estiver desabilitado): veja a
  duração entre "Tarefa iniciada" e "Tarefa concluída". Esperado: menos de 2 s com o serviço parado
  e até ~15 s com o PC da TI desligado.

**8. Deep Freeze ou UWF (se tiver uma máquina assim)**
1. Prepare com a máquina **descongelada**; congele de novo.
2. A página da máquina deve mostrar "Congelamento: detectado (congelada): Deep Freeze" ou "detectado
   (estado não verificado)". Me diga qual, e onde fica o `DFC.exe` nessa máquina.
3. Se tiver ThawSpace (ex.: `T:`): em **Preparar máquinas → Laboratório com Deep Freeze ou
   similar**, informe `T:\UniWake`, **Atualizar comando**, rode de novo (descongelada) e repita o
   passo 5 depois de reiniciar a máquina congelada.

**9. Revogar e remover**
1. Na página da máquina (como administrador): **Revogar desligamento remoto** → a máquina passa a
   "Desligamento revogado" e **Desligar** não a inclui mais.
2. Para remover tudo: baixe o `prepare-target.ps1` em **Preparar máquinas** e rode
   `.\prepare-target.ps1 -RemoveAgent` como Administrador. As três tarefas e a pasta
   `C:\ProgramData\UniWake\agent` somem.

**O que me mandar:** prints do resumo do preparo e do quadro "Desligamento remoto", o que apareceu
no passo 3, e qualquer passo que não deu o resultado esperado (com o horário, para eu cruzar com os
logs em **Logs**). Não publique IPs, MACs ou nomes reais em issues públicas.

Depois do seu teste: eu corrijo o que aparecer. A v1.3 só vai para a `main` quando você disser
"pode subir a dev para a main", e a tag só se você pedir.

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
- **2026-10-12: v1.4.0 released from `main` (`8e1b794`) on the owner's request (includes v1.3). Before that: v1.3 and v1.4 complete on `dev`** (M16–M24, Phases 10–12: `specs/validation.md`
  §v1.3/§v1.4, `specs/reviews/v1.3-final.md`, `v1.4-final.md`, reviews M16–M23). Not merged, not
  tagged. CLAUDE.md stop point reached: final report given; waiting for the owner's real-PC
  checklists above (v1.4 and v1.3) and for "pode subir a dev para a main".
- v1.4 lives in `apps/server/src/application/migration/*` (document, secret-box, export, import,
  auto-export), `db/sync/import.ts`, `db/repositories/migration-repo.ts`, migration 007,
  `http/routes/migration.ts`, `cli/migration-cli.ts` (+ `main.ts` flags), `apps/web/src/features/migration/*`;
  tests `apps/server/test/{export-format,secret-box,migration-*,breakit-m21,breakit-m22,auto-export}.test.ts`,
  `perf/migration.perf.test.ts`, web `migration-page.test.tsx`, `e2e/migration.spec.ts`.
- Architect assumptions A-1..A-5 (ADR-049..052) are open to the owner's change.
- Remote shutdown (v1.3): `application/power/*`, `scripts/agent/*`, `scripts/prepare-target.ps1` step 8.
- CI on `dev` uploads `UniWake-Setup-dev` (`DEV_VERSION_BASE` 1.4.0, ADR-041).

### Next steps
1. Fix whatever the owner's checklists find (tests first). If the warning window does not show in
   the user session, revisit the "UniWake Aviso" task (ADR-046, M18-T01).
2. On "pode subir a dev para a main": green verify, merge `dev` → `main`; tag only if asked
   (release notes for 1.3.0/1.4.0 to write then).
3. Roadmap after v1.4: RM-1..RM-8 (spec §11); nothing started.

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
- R-M16-01: Vitest workers sometimes die natively (0xC0000409; Git Bash shows exit 127) on this PC.
  Server tests run in `forks` so the crash names one file; the helper reruns verify once only for that
  signature. Run Vitest from `C:/git/UniWake` (uppercase drive): from `c:` it loads modules twice
  and every file fails with "failed to find the current suite".
- Tests can never start `ping.exe` to a non-loopback host or any `shutdown.exe`: the guard in
  `apps/server/test/setup/network-guard.ts` throws (constitution §5).
- Node runs repo `.ts` scripts with type stripping; files with parameter properties need
  `--experimental-transform-types`.
