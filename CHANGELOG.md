# Histórico de versões

Todas as mudanças importantes do UniWake, da mais nova para a mais antiga. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/). As notas completas de cada versão estão em
[`specs/releases/`](specs/releases/) e na página de [Releases](https://github.com/BryanWalace/UniWake/releases).

## [Não publicado]

Nada por enquanto.

## [1.7.1] — 2026-11-09

Correção de segurança das dependências; traz todas as novidades da 1.7.0, cujo instalador não chegou
a ser publicado. [Notas completas](specs/releases/v1.7.1.md).

### Segurança
- Dependências do serviço atualizadas para corrigir avisos de segurança publicados depois da 1.7.0:
  `fastify` 5.12.8 (validação de cabeçalhos), `zod` 4.6.7 (consumo de memória ao validar listas
  grandes), `@fastify/static` 10.1.10 (`glob`/`minimatch`) e `fast-uri` 3.1.9/4.2.3. Sem mudança de
  uso. Esses avisos travavam a verificação do CI e impediram a publicação do instalador da 1.7.0.

## [1.7.0] — 2026-11-09

Ligar e desligar garantidos. [Notas completas](specs/releases/v1.7.0.md). A tag foi criada, mas o
instalador não foi publicado (a verificação de segurança das dependências barrou); estas novidades
chegam pela **1.7.1**.

### Adicionado
- **Novas tentativas para quem não ligou**: durante a verificação, as máquinas que ainda não
  responderam recebem o pacote de novo a cada minuto (até 3 vezes), agora também com um envio direto
  ao último IP conhecido. Configurável em **Configurações → Ligar**.
- **Máquinas vizinhas mandam o pacote**: até 3 máquinas preparadas e ligadas da mesma sala (ou da
  mesma rede) recebem o pedido na consulta seguinte e mandam o pacote de ligar de dentro da rede delas
  — passa por roteadores e switches que bloqueiam o pacote vindo do PC do UniWake.
- O agente **reativa o "ligar pela rede"** (Magic Packet, ligar a partir do desligamento, Ethernet
  com eficiência energética desligada, Inicialização rápida desligada) ao iniciar, a cada 6 horas e
  logo antes de cada desligamento; a página da máquina mostra o resultado em **Ligar pela rede**.
- **Desligamento que insiste**: se o Windows recusar o desligamento (por exemplo, código 1190 — já
  havia um desligamento agendado), o agente cancela e pede de novo, ou usa outro caminho (CIM,
  Stop-Computer). Se a máquina continuar ligada 3 minutos depois do horário, o agente **força o
  desligamento** (até 3 tentativas) e a página da máquina lista em "Desligamentos que o agente teve de
  forçar".
- **Erros que aparecem**: o agente grava `agent.log` na máquina e manda os últimos erros ao UniWake
  (página da máquina → "Erros recentes do agente" e **Logs**). O **Logs** do serviço registra cada
  ligação com as máquinas que não ligaram e o motivo, cada nova tentativa, os relatórios de
  desligamento que falharam e as falhas do próprio serviço (inclusive quando ele parou de repente).
- A página da ligação mostra a **tentativa** de cada pacote e quais saíram por uma máquina vizinha.

### Alterado
- O agente das máquinas passa para a versão **1.8.0** (chega sozinho às máquinas preparadas).
- Uma falha no aviso do Windows (sem a janela do UniWake) não cancela mais o desligamento: ele
  acontece no horário.

## [1.6.0] — 2026-10-18

Máquinas que se atualizam e avisam. [Notas completas](specs/releases/v1.6.0.md).

### Adicionado
- O agente das máquinas **se atualiza e se conserta sozinho**: confere cada arquivo gravado, guarda
  uma cópia conferida e cria a tarefa **"UniWake Reparo"**, sem precisar preparar a máquina de novo.
- Marcas **"Agente bloqueado"** e **"Agente desatualizado"** em Dispositivos e na Saúde do sistema.
- Aviso **"Antivírus bloqueou o UniWake"** no painel inicial, com leitura direta do Microsoft Defender
  e a ajuda "Antivírus e o agente do UniWake".
- O formulário de agendamento mostra as máquinas que **ficam de fora** e o motivo.
- Máquinas **suspensas ou hibernadas** acordam pelo despertador do Windows e desligam no horário; a
  página da máquina mostra a hibernação e a última ausência sem reiniciar.
- Opção **"Impedir suspensão e hibernação"** (desligada por padrão).

### Alterado
- **Salvar ou editar um agendamento nunca desliga as máquinas na hora.**
- "Mandar o pacote de ligar para as máquinas que não respondem, ao desligar" vem **desligado por
  padrão** (ele também liga as máquinas que estavam desligadas).
- Uma máquina desligada **antes** do horário e ligada **depois** dele não é desligada; o painel
  mostra "estava desligada".

### Corrigido
- A janela do aviso com **"Adiar"** voltou a abrir depois de uma atualização ou reparo do agente.
- A máquina acordada pelo despertador não volta a dormir antes do fim do aviso.
- O agente volta a funcionar logo depois de a máquina sair da hibernação.
- `prepare-target.ps1 -RemoveAgent` também remove a tarefa "UniWake Reparo".

## [1.5.0] — 2026-10-16

Desligamento agendado e status confiáveis. [Notas completas](specs/releases/v1.5.0.md).

### Adicionado
- **Conferência 10 minutos depois** de cada desligamento agendado: quantas desligaram, por qual
  caminho, quais adiaram, ainda ligadas ou sem resposta; as "ainda ligadas" recebem uma nova tentativa.
- A página da máquina mostra qual sinal confirmou o estado e de onde veio o IP.

### Corrigido
- O desligamento agendado funciona mesmo quando a agenda guardada na máquina não tem o horário: o
  UniWake também manda a ordem direto, e a máquina desliga uma vez só.
- Status Ligada/Desligada certo para máquinas que bloqueiam ping (agente, ping, portas TCP e tabela
  ARP); o IP acompanha o MAC quando o DHCP muda o endereço.
- Melhorias no diagnóstico e no instalador.

## [1.4.0] — 2026-10-12

Desligar computadores e backup e migração. [Notas completas](specs/releases/v1.4.0.md).

### Adicionado
- **Desligar e reiniciar** pela sala, pela máquina ou por agendamento, com aviso na tela e opção de
  adiar; funciona com o PC da TI desligado no horário (o que seria a 1.3).
- Suporte a laboratórios com Deep Freeze ou similar.
- **Backup e migração** em arquivo `.uniwake`: exportar e importar com prévia e senha, exportação
  automática e linha de comando.

## [1.2.0] — 2026-10-09

Primeira versão estável. [Notas completas](specs/releases/v1.2.0.md).

### Adicionado
- **Modo equipe**: dois ou mais PCs da TI com o mesmo cadastro, sem servidor.
- **Descobrir na rede** (o que seria a 1.1).
- Tudo da 1.0.

## [1.0.0] — 2026-10-06 (versões de teste rc.1 e rc.2)

Primeira versão. [Notas completas](specs/releases/v1.0.0.md).

### Adicionado
- Ligar pela rede (Wake-on-LAN) por sala, etiqueta ou máquina, painel em tempo real, agendamentos
  com feriados, preparo e cadastro automático das máquinas, usuários e auditoria, backups e
  atualização automática.

[Não publicado]: https://github.com/BryanWalace/UniWake/compare/v1.6.0...dev
[1.6.0]: https://github.com/BryanWalace/UniWake/releases/tag/v1.6.0
[1.5.0]: https://github.com/BryanWalace/UniWake/releases/tag/v1.5.0
[1.4.0]: https://github.com/BryanWalace/UniWake/releases/tag/v1.4.0
[1.2.0]: https://github.com/BryanWalace/UniWake/releases/tag/v1.2.0
[1.0.0]: https://github.com/BryanWalace/UniWake/releases/tag/v1.0.0-rc.2
