# NEXT — handoff

Atualizado: 2026-10-18 · Branch de trabalho: **`dev`** (ADR-030).
**A 1.6.0 foi para a `main` (`536f477`) e a tag `v1.6.0` foi criada a seu pedido em 18/10.** O workflow de
release publica o instalador; o PC do UniWake se atualiza na janela de manutenção e as máquinas pegam o agente
1.7.0 na consulta seguinte. Confira em GitHub → Actions → "Release" (v1.6.0) e em Releases.

## Teste no notebook (18/10) — resultado
Relatório completo: `specs/reviews/field-test-2026-10-18.md`. Conferido em hardware real: atualização sozinha,
reparo, leitura do Defender, exclusões, regra de salvar, impedir suspensão, aviso com "Adiar" e cancelar pelo
painel, acordar da hibernação pelo despertador e o caso de quem desliga antes da hora. Corrigido:
1. **A janela do aviso com "Adiar" não abria** (existia desde a v1.3): depois de atualizar ou reparar, o arquivo
   da janela ficava sem permissão de leitura para os usuários. O agente agora corrige sozinho a cada minuto.
2. **A máquina acordada pelo despertador voltava a dormir em ~2 min**: agora fica acordada até o fim do aviso.
3. **Depois de hibernar, o UniWake parava até alguém mexer**: a tarefa agora também roda ao acordar.
4. **"Acordar para desligar" agora vem desligado** (você pediu: só tratar máquina hibernada/suspensa; máquina
   desligada não deve ligar para desligar). O nome na tela ficou "Mandar o pacote de ligar para as máquinas que
   não respondem, ao desligar", com o aviso de que liga as desligadas.
5. **Quem desliga antes da hora:** máquina desligada antes do horário e ligada depois **não desliga**; no painel
   aparece "estava desligada" (não "Falhou"). Hibernada continua desligando no horário.
6. Menos arquivos temporários durante o aviso; `-RemoveAgent` também remove a tarefa "UniWake Reparo".

**Limpeza feita:** no notebook saíram as 4 tarefas, `C:\ProgramData\UniWake`, o script baixado, a regra de ping,
o servidor SSH, a chave e a regra de firewall do SSH; o plano de energia voltou ao que era. **Ficou** a
Inicialização Rápida desligada e os despertadores do Windows ligados (feitos pelo preparo; o valor original
não foi anotado). Neste PC saíram o UniWake de teste, os dados dele e a chave SSH. Nenhum dado do notebook
ficou no repositório ou na memória.

**Notas para o agente (próximas sessões):** o preparo continua recusando placa só Wi-Fi (de propósito); para
testar num notebook Wi-Fi, o ajuste vai só na cópia de `build/stage` e some com `npm run build:app`. Testes de
fumaça do pacote: ligar `wake.dryRun` antes de tudo.

## Próximo passo
- Release v1.6.0 publicada (18/10, instalador + SHA-256). No dia seguinte, confira a Saúde do sistema: `1.6.0`.
- **Documentos públicos (ADR-062, regra sua de 18/10):** README, CHANGELOG, CONTRIBUTING, SECURITY,
  CODE_OF_CONDUCT, LICENSE e modelos de issue/PR revisados a cada atualização; `npm run check:docs` confere
  no `verify` e na release. Falta você criar no GitHub o rótulo **`shutdown`** (Issues → Labels → New label).
- Depois: o roteiro abaixo ("Como testar a v1.6.0") vale para conferir no laboratório.

## v1.6.0 — exclusões visíveis, agente que se atualiza e avisa, hibernação (na `dev`, aguardando seu teste)

> Nos documentos técnicos é a "revisão 1.7" da especificação; a versão do programa é **1.6.0** (a de teste,
> `1.6.0-dev.N`). O agente nas máquinas passa a **1.7.0**.

**O que o seu log de 16/10 mostrou e foi corrigido:**
1. **O agendamento "teste" não desligou porque a única máquina da sala estava excluída** ("Nunca desligar por
   agendamento" ou etiqueta excluída). O formulário dizia "alcança 1 máquina pronta" porque usava a prévia do
   Desligar manual (que inclui essas máquinas com confirmação). **Agora o formulário segue as regras do
   agendamento** e diz "N máquinas ficam fora deste agendamento: NOME (motivo)". A conferência das T+10 e o
   Histórico também mostram as excluídas com o motivo, em vez de "nenhuma máquina no alvo".
2. **As ordens saíram ~1min40s depois do horário** porque o agendamento foi salvo com um horário que já tinha
   passado. **Agora salvar ou editar um agendamento nunca desliga as máquinas na hora**; para testar rápido,
   use "Testar agendamento" na página da máquina.

**Novidades:**
3. **Atualização do agente que funciona e avisa** (sem preparar de novo):
   - o agente confere cada arquivo depois de gravar e conta ao UniWake o que aconteceu (atualizado, não
     conseguiu baixar, bloqueado — com o código do antivírus —, apagado logo depois de gravado);
   - ele mesmo instala os passos novos: uma **cópia conferida** dos scripts e a tarefa **"UniWake Reparo"**,
     que restaura um arquivo apagado e avisa o painel;
   - lista de Dispositivos: **"Agente bloqueado"** / **"Agente desatualizado"**; Saúde do sistema avisa os
     dois.
4. **Aviso de antivírus:** "Antivírus bloqueou o UniWake em N máquinas" no painel inicial, com a máquina, o
   arquivo, o antivírus e a hora. O Microsoft Defender é lido diretamente (arquivo, nome da ameaça, ação);
   outros antivírus são percebidos pelo efeito (gravação recusada, arquivo sumido) e o UniWake diz qual está
   instalado. Nova ajuda "Antivírus e o agente do UniWake". **O UniWake nunca cria exceção no antivírus
   sozinho.**
5. **Computadores hibernados ou suspensos:**
   - **"Acordar para desligar"** (**desligado por padrão desde 18/10**): quando marcado, as máquinas prontas que
     não respondem mas falaram com o UniWake nas últimas 12 h recebem o pacote de ligar e desligam ao acordar;
   - a página da máquina mostra a hibernação ("após 180 minutos") e a **última ausência sem reiniciar**
     ("Hibernada de … a … — não desligou");
   - **"Impedir suspensão e hibernação"** (desligado por padrão, como você pediu): o agente desliga a
     suspensão e a hibernação automáticas na tomada e a hibernação do Windows; ao desmarcar, volta o que era.

**Um erro meu durante a validação (já corrigido):** no primeiro teste de fumaça do pacote, aqui no seu PC, o
"Desligar" manual de teste acionou o "Acordar para desligar" e o UniWake de teste **enviou um pacote de ligar
real na sua rede** para um MAC inventado (`02:00:00:00:AB:01`). Nenhuma máquina tem esse MAC, então nada ligou.
Os testes de fumaça agora ligam o modo simulação antes de tudo (o segundo rodou 27/27 sem enviar nada).

### Como testar a v1.6.0 (passo a passo)

**0. Instalar a versão de teste no PC do UniWake**
1. GitHub → **Actions** → o último **CI** verde da branch `dev` → **Artifacts** → **UniWake-Setup-dev**
   (`UniWake-Setup-1.6.0-dev.N.exe` + `.sha256`). Confira com `Get-FileHash .\UniWake-Setup-1.6.0-dev.N.exe`.
2. Instale por cima da 1.5.0 (backup automático). **Saúde do sistema**: `1.6.0-dev.N`. Ela não volta sozinha
   para a 1.5.0; só se atualiza quando sair uma release estável mais nova.

**1. As máquinas pegam o agente novo sozinhas**
1. Ligue as máquinas de teste. Em 1–2 minutos, a página de cada uma mostra **Versão do agente 1.7.0**.
2. **Dispositivos**: procure **"Agente desatualizado"** ou **"Agente bloqueado"** embaixo do status. Em
   **Saúde do sistema** aparecem os dois avisos com os nomes.
3. Uma máquina que continua desatualizada depois de 10 minutos ligada: abra a página dela →
   "Última atualização do agente" diz o motivo. Se for antivírus, veja o passo 4. Se o agente nem consulta
   ("Desligamento remoto perdido"), prepare essa máquina **uma última vez** — depois disso, as próximas
   atualizações chegam sozinhas.

**2. Exclusões (a causa do seu teste de 16/10)**
1. **Agendamentos** → abra o "teste" (ou outro de Desligar). Embaixo do alvo: "Hoje este agendamento alcança
   N máquinas prontas" e, se houver, **"N máquinas ficam fora deste agendamento: NOME (Nunca desligar por
   agendamento / etiqueta excluída neste agendamento)"**.
2. Se a máquina não devia ficar de fora: na página dela, desmarque "Nunca desligar por agendamento" ou tire a
   etiqueta das excluídas do agendamento. Salve e confira que o aviso sumiu.
3. Depois de um desligamento agendado, em **Agendamentos → Execuções**, a conferência das T+10 lista as
   excluídas com o motivo.

**3. Salvar não desliga na hora**
1. Edite um agendamento de Desligar e ponha um horário que **acabou de passar** (ex.: 1 minuto atrás). Salve.
2. Esperado: **nada desliga**. Para testar rápido, use **Testar agendamento** (página da máquina).

**4. Reparo automático e aviso (simula o antivírus, sem antivírus)**
1. Num PC de teste, abra o PowerShell **como administrador** e apague o arquivo do aviso:
   `Remove-Item C:\ProgramData\UniWake\agent\uniwake-aviso.ps1`
2. Abra o **Agendador de Tarefas** → Biblioteca → **UniWake Reparo** → botão direito → **Executar** (ou espere até
   30 minutos).
3. Esperado: o arquivo volta; em 1–2 minutos o painel inicial mostra **"Antivírus bloqueou o UniWake em 1
   máquina: … uniwake-aviso.ps1 sumiu e foi restaurado da cópia do UniWake"** e a página da máquina mostra
   "Bloqueios do agente". Clique **Ciente** no aviso.
4. Se essa tarefa não existir: a máquina ainda não rodou o agente 1.7.0 (veja o passo 1).

**5. Antivírus de verdade (só observar)**
1. Na página de uma máquina, a linha **Antivírus** mostra o que o Windows informa (ex.: "Microsoft Defender
   Antivirus"; "(desatualizado)" quando for o caso).
2. Se algum antivírus pegar um arquivo do UniWake, o aviso aparece sozinho no painel inicial. **Não tente criar
   um arquivo "infectado" para testar.** Se aparecer, siga Ajuda › Antivírus e o agente do UniWake (liberar
   `C:\ProgramData\UniWake` no antivírus).

**6. Hibernada: acordar para desligar**
1. Num PC de teste preparado, sem usuário: `shutdown /h` (hiberna). Espere ele apagar.
2. No painel, página da máquina → **Testar agendamento** → **5** minutos.
3. Esperado: em até 1 minuto o UniWake manda o pacote de ligar; o PC acorda (se a placa de rede acordar da
   hibernação — não verificado no seu modelo), mostra o aviso e **desliga de verdade**. Depois de ligar de novo,
   a página mostra **"Última ausência sem reiniciar: Hibernada de … a … — não desligou"**.
4. No **Desligar** manual de uma sala, com máquinas apagadas, o resumo agora diz quantas "vão receber o pacote
   de ligar para acordar e desligar". Para desligar essa função: Configurações → Desligar computadores →
   "Acordar máquinas suspensas ou hibernadas para desligar".

**7. Impedir suspensão e hibernação (opcional, desligado por padrão)**
1. **Configurações → Desligar computadores → "Impedir suspensão e hibernação nas máquinas"** → marque e salve.
2. Em 1–2 minutos, na página de uma máquina ligada: **"Impedir suspensão e hibernação: aplicado em …"**,
   **"Suspensão (na tomada): nunca"** e **"Hibernação (na tomada): desativada"**.
3. Desmarque e salve: em 1–2 minutos, **"desfeito (valores de antes)"** e os valores antigos de volta.
4. Em máquinas congeladas, o agente aplica de novo a cada reinício (o congelamento volta o plano de energia).

**Se algo falhar, me mande:** print da página da máquina (quadro "Desligamento remoto" inteiro), o aviso do
painel inicial, e em **Logs** as linhas "agent", "power-test", "woke sleeping machines", "scheduled shutdown".

Quando estiver bom, me diga se quer publicar ("pode subir a dev para a main" e se quer a release 1.6.0). As notas
já estão prontas em `specs/releases/v1.6.0.md`.

## v1.5 — correções do desligamento agendado e do status (publicada na v1.5.0, aguardando seu teste)

> Nos documentos técnicos (specs) isto aparece como "v1.6" — é a revisão da especificação. A versão
> do programa é **1.5.0** (a de teste é `1.5.0-dev.N`). O agente nos PCs tem numeração própria: **1.6.0**.

O que mudou, em resumo:

1. **Desligamento agendado por dois caminhos.** Além da agenda que a máquina guarda (como antes), o
   UniWake agora **manda a ordem direto** para cada máquina pronta, 1 minuto antes do aviso começar
   (com aviso de 5 min, 6 min antes do horário). As duas coisas levam o **mesmo código de execução**:
   a máquina desliga **uma vez só**, venha por onde vier. O aviso, o "Adiar" com usuário logado, as
   etiquetas excluídas e o "Nunca desligar por agendamento" valem nos dois caminhos. Se o UniWake
   estiver desligado no horário, a agenda da máquina desliga sozinha (como antes).
2. **Conferência 10 minutos depois.** Em **Agendamentos → Execuções dos agendamentos** e no **Histórico**, cada
   desligamento agendado ganha "conferência às T+10" com quantas desligaram e **por qual caminho**
   (pela agenda / por ordem direta), adiadas por usuário ativo, ainda ligadas, sem agente, agenda
   desatualizada, sem resposta. As "ainda ligadas" sem motivo recebem **uma** nova tentativa.
3. **Por que a agenda vinha vazia.** Não consegui reproduzir aqui (bancos novos e atualizados da
   1.2 geram a agenda certa). A versão `8a818e7a…` que você viu é exatamente a de uma **agenda
   vazia**: o UniWake não achou nenhum agendamento para aquele cadastro. A causa mais provável
   (não verificado) é a máquina estar cadastrada **duas vezes** (o preparo criou um registro novo e os
   agendamentos/sala apontam para o antigo). Agora:
   - a página da máquina mostra **cada agendamento de desligar e o motivo** de incluir ou não a máquina;
   - o painel inicial avisa **"Possível máquina duplicada"** quando o preparo cria um cadastro com o
     mesmo nome de computador de outro;
   - o formulário do agendamento de desligar mostra **quantas máquinas prontas ele alcança** e quais
     não estão prontas, e avisa se inclui o próprio PC do UniWake.
   E mesmo que a agenda falhe de novo, a ordem direta desliga a máquina.
4. **Status "Ligada"/"Desligada".** A máquina está ligada se **qualquer** sinal disser que sim:
   consulta do agente nos últimos 2 min, ping, portas (135/445/3389) ou a tabela ARP do Windows. Só
   fica "Desligada" depois de **duas varreduras seguidas** sem nenhum sinal. O IP **segue o MAC**
   (agente → tabela ARP → DNS). A página da máquina mostra qual sinal confirmou ("Ligada — agente",
   "— ping"…) e de onde veio o IP ("(pela tabela ARP)").
5. **"probe helper missed its deadline" em todo início:** causa achada e corrigida — um único
   endereço vazio fazia o lote inteiro de ping falhar e todas as máquinas do lote apareciam
   desligadas.
6. **Botão "Testar agendamento"** na página da máquina (quadro "Desligamento remoto"): um desligamento
   agendado só daquela máquina daqui a N minutos (2 a 60), pelos dois caminhos, com conferência.
7. **Instalador:** a atualização por cima não falha mais com "O serviço UniWake não parou" quando o
   serviço para rápido demais (falha do WinSW que apareceu no CI; ADR-057).

Decisões que tomei sozinho (pode mudar qualquer uma): ordem direta 1 min antes do aviso e até 60 min
depois do horário (ADR-053); conferência às T+10 com uma nova tentativa (ADR-054); "ligada" com
qualquer sinal e "desligada" só após 2 varreduras (ADR-055); o "Testar agendamento" ignora feriado e
pausa (é um teste explícito), mas recusa máquina sem agente ou marcada "Nunca desligar" (ADR-056).

### Como testar as correções da v1.5 num PC do laboratório (passo a passo)

Use **um PC de laboratório de teste** (fora de aula, que pode ser desligado) e o PC onde o UniWake
roda. Nada disso exige programa extra nas máquinas.

**0. Ter a 1.5.0 no PC do UniWake**
1. O PC se atualiza sozinho na janela 03:00–05:00. Para não esperar: baixe o
   **UniWake-Setup.exe** da release **v1.5.0** no GitHub (botão de download do README) e o
   `.sha256`; confira com `Get-FileHash .\UniWake-Setup.exe` (SHA-256
   `c1248b3e7852039b092832c30059a88a6d1d5fd528215322275199bc1559862d`) e instale por cima (um backup
   é feito antes).
2. Painel → **Saúde do sistema**: versão `1.5.0`.
3. **Logs** (administrador): logo depois do início **não** deve aparecer "probe helper missed its
   deadline". Reinicie o serviço uma vez (services.msc → UniWake → Reiniciar) e confira de novo.

**1. Agente atualizado no PC de teste (não precisa preparar de novo)**
1. Ligue o PC de teste. Em até 1–2 minutos ele baixa o agente novo sozinho.
2. Página da máquina → quadro **Desligamento remoto**: "Pronta para desligar" e versão do agente
   **1.6.0**. Se depois de 5 minutos continuar a versão antiga, rode de novo o comando de **Preparar
   máquinas** nela.

**2. Conferir o cadastro (a causa provável da agenda vazia)**
1. **Painel inicial:** apareceu **"Possível máquina duplicada"**? Se sim, ele diz os dois cadastros e
   os MACs. Se forem o mesmo PC, exclua o cadastro antigo (o que **não** tem o agente) e confira a
   sala/etiquetas do que ficou.
2. Na **lista de Dispositivos**, procure o nome do PC de teste: existe mais de uma linha com o mesmo
   nome ou o mesmo MAC? Anote.
3. Página da máquina → **Desligamento remoto** → bloco **Desligamento agendado**:
   - **Agendamentos de desligar:** cada agendamento aparece com o motivo. O do laboratório deve dizer
     **"Inclui esta máquina — próximo em …"**. Se disser "O alvo do agendamento não inclui esta
     máquina", "Uma etiqueta desta máquina está excluída" ou "Máquina marcada Nunca desligar…",
     **esse é o motivo da agenda vazia**: tire um print e me mande antes de mudar.
   - **Agenda entregue à máquina** e **Agenda atual no UniWake** devem ter o mesmo número de horários
     e a mesma versão (em até 1 minuto). Versão começando com `8a818e7a` = agenda vazia.
   - **Próximo desligamento:** o horário local esperado.

**3. "Testar agendamento" sem ninguém logado (os dois caminhos)**
1. Faça logoff no PC de teste (fica na tela de login).
2. Página da máquina → **Testar agendamento** → **5** minutos → **Agendar teste**.
3. A linha **Teste de agendamento** mostra "desligar às HH:MM (aviso de 4 minutos): agendado". Em
   até 1 minuto passa para **"ordem enviada, aguardando o horário"**.
4. No horário, o PC desliga **uma vez** (não reinicia nem desliga duas vezes).
5. **10 minutos depois** do horário, a linha mostra **"Desligou por ordem direta"** (ou "pela
   agenda"). Em **Histórico**, aparece **"Testar agendamento (NOME-DO-PC)"** com 1 desligou.

**4. Com usuário logado (aviso e "Adiar")**
1. Ligue o PC de teste e entre com um usuário.
2. **Testar agendamento** → **10** minutos.
3. Uns 5 minutos antes, a janela de aviso aparece na sessão do usuário. Clique **Adiar** uma vez.
4. Esperado: não desliga no horário; o aviso volta 15 minutos depois e, sem novo "Adiar", desliga. Na conferência (T+10) aparece **"adiado — usuário ativo"**, não "ainda ligado".

**5. Só a agenda (UniWake parado na hora da ordem)**
1. PC de teste ligado, sem usuário. **Testar agendamento** → **15** minutos.
2. Espere a linha **Agenda entregue à máquina** mudar de versão (até 1 minuto).
3. **Antes de 8 minutos** desde o agendamento do teste: no PC do UniWake, services.msc → **UniWake** →
   **Parar**.
4. No horário, o PC de teste desliga **sozinho pela agenda**.
5. Inicie o serviço de novo. 10 minutos depois do horário: **"Desligou pela agenda"**.

**6. Um agendamento de verdade**
1. **Agendamentos** → novo, ação **Desligar**, alvo a **sala** do PC de teste (ou só o PC), horário
   daqui a **15 minutos**, hoje marcado.
2. No formulário, confira o aviso de alcance ("Hoje este agendamento alcança N máquinas prontas para
   desligar", quais não estão prontas e se inclui o PC do UniWake). **Desmarque/retire as outras máquinas da sala se houver aula.**
3. Esperado: o PC desliga no horário. Em **Agendamentos → Execuções dos agendamentos**: "desligar: ordem para N
   máquina(s)…; conferência às T+10: N desligou (pela agenda: x, por ordem direta: y)".
4. Desative ou exclua esse agendamento de teste.
5. No dia seguinte, confira que o **agendamento de Ligar** continuou funcionando igual (não mexi nele;
   há testes, mas o real é o que vale).

**7. Status ligada/desligada**
1. Com o PC de teste ligado, **Dispositivos** mostra **Ligada**. Na página dele: "Ligada — agente" (ou
   ping/portas/tabela ARP). Antes, as que tinham ping bloqueado apareciam desligadas.
2. Desligue o PC: em até ~2–3 minutos (duas varreduras de 60 s) passa para **Desligada**, não antes.
3. Se puder trocar o IP (no PC de teste: `ipconfig /release` e `ipconfig /renew`, ou outra tomada
   de rede): em poucos minutos a página mostra o IP novo com "(pelo agente)" ou "(pela tabela ARP)".
4. Confira as outras máquinas ligadas dos laboratórios: as que estavam "Desligada" erradas agora
   devem aparecer "Ligada".

**Se algo falhar, me mande:**
- print do bloco **Desligamento agendado** da página da máquina (com a lista de agendamentos e motivos);
- o detalhe da execução (Agendamentos → Execuções dos agendamentos) ou a linha do **Histórico**;
- em **Logs**, as linhas perto do horário: "schedule fired", "scheduled shutdown pushed",
  "agenda changed", "agenda served with a new version", "scheduled shutdown reconciled" (e "scheduled
  shutdown test …" no teste);
- se aparecer "Possível máquina duplicada", os dois nomes/MACs (pode cobrir os MACs no print, só me
  diga se são iguais ou diferentes).

Se algo falhar, eu corrijo na `dev` e só levo para a `main` (e uma nova release) quando você pedir.

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
- **2026-10-17: v1.6.0 (spec §6e, revision 1.7) complete and validated on `dev`** — M28 (schedule reach
  with the schedule's exclusions; excluded result; ADR-058 save rule), M29 (agent health contract with
  feature negotiation, migration 009, verified self-update, self-install level 2 with the verified copy
  and "UniWake Reparo", antivirus via Security Center + Defender, notices/marks/help; ADR-059/060), M30
  (resume/hibernation facts, "Acordar para desligar", "Impedir suspensão e hibernação"; ADR-061), Phase 16
  (`validation.md` §v1.7). Agent script 1.7.0. Not merged, not tagged; release notes ready in
  `specs/releases/v1.6.0.md`. **STOP point:** waiting for the owner's checklist above.
- **2026-10-16: field fixes (spec §6d, product version 1.5.0, spec revision "v1.6") complete and
  validated on `dev`** — M25 (scheduled shutdown push + one execution + T+10 reconciliation,
  ADR-053/054), M26 (online status from agent/ICMP/TCP/ARP, IP follows MAC, probe-helper fix,
  ADR-055), M27 (diagnostics, duplicate notice, "Testar agendamento", info logs, ADR-056), Phase 14
  (`validation.md` §v1.6), installer WinSW stop race (ADR-057). `DEV_VERSION_BASE` bumped to 1.5.0.
  **Released as v1.5.0 on the owner's request** (merge `7eb76bc` on main, tag `v1.5.0`, installer
  SHA-256 c1248b3e…862d verified). Waiting for the owner's lab-PC checklist above.
- Field root cause of the empty agenda **not reproduced**; most likely a duplicate/moved device
  record (não verificado). Code: `domain/agenda.ts` (explainAgenda, one-offs),
  `application/power/{diagnostics,shutdown-test,reconcile,self-device}.ts`, migration 008,
  tests `apps/server/test/{scheduled-shutdown,shutdown-diagnostics}.test.ts`, fake agent
  `apps/server/test/helpers/fake-agent.ts`.
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
- CI on `dev` uploads `UniWake-Setup-dev` (`DEV_VERSION_BASE` 1.6.0, ADR-041).

### Next steps
0. v1.6.0: act on the owner's results (tests first). On "pode subir a dev para a main": verify, merge, tag
   `v1.6.0` only if asked (notes ready). Field items still não verificados: event 42 TargetState, wake
   from S4, third-party antivirus, whether an antivirus flags the repair task's inline command.
0. v1.5 field fixes: act on the owner's lab-PC results (tests first). If a schedule still misses a
   machine, the device page reason and the "possible_duplicate" notice name the record to fix. Fixes
   go to `dev` again; `main`/tags only on a new explicit request.
1. Fix whatever the owner's checklists find (tests first). If the warning window does not show in
   the user session, revisit the "UniWake Aviso" task (ADR-046, M18-T01).
2. On "pode subir a dev para a main": green verify, merge `dev` → `main`; tag only if asked
   (release notes for 1.3.0/1.4.0 to write then).
3. Roadmap after v1.4: RM-1..RM-8 (spec §11); nothing started.

### Working conventions
- **Package smoke on the owner's PC: `PATCH /api/settings {"wake.dryRun": true}` first** and check
  `wake_jobs.dry_run = 1` after (2026-10-17: a smoke run without it sent one real magic packet through
  "Acordar para desligar"). Agent check-ins are limited to 6 per minute per machine: space them.
- Pester locally: `.tools/psmodules/Pester/5.9.1` (scratchpad `pester-one.ps1 -Path <file>`); the
  real "UniWake Reparo" registration test runs only on CI (`GITHUB_ACTIONS=true`).
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
