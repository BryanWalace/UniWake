# UniWake

O UniWake liga pela rede (Wake-on-LAN), monitora e agenda os computadores dos laboratórios da
faculdade, organizados por salas e etiquetas. Ele roda como um serviço do Windows em um computador
da rede (o "computador do UniWake") e é usado pelo navegador.

- Ligar uma sala, uma etiqueta ou uma máquina com um clique, vendo quem acordou.
- Ver quais máquinas estão ligadas, por sala, e o histórico de cada uma.
- Agendar ligações (ex.: segunda a sexta às 06:50), com feriados e pausa.
- Preparar as máquinas e cadastrá-las automaticamente com um comando.
- Diagnóstico de quem não liga e páginas de ajuda.
- Atualização automática, backups diários e auditoria de tudo o que foi feito.

## Requisitos

- Computador do UniWake: Windows 10 ou 11 (64 bits), sempre ligado, **conectado por cabo** à rede
  dos laboratórios. Não precisa de ninguém logado.
- Máquinas dos laboratórios: Windows 10 ou 11 com placa de rede cabeada que suporte Wake-on-LAN.
- Rede: o Magic Packet é um broadcast e não atravessa roteadores sozinho. Se as salas estiverem em
  outra rede (VLAN), veja [Redes diferentes](#redes-diferentes-vlan).

## Instalação

1. Baixe `UniWake-Setup.exe` da [última versão](https://github.com/BryanWalace/UniWake/releases/latest)
   e, se quiser conferir, compare o SHA-256 com `UniWake-Setup.exe.sha256`:
   ```powershell
   Get-FileHash .\UniWake-Setup.exe -Algorithm SHA256
   ```
2. Execute como administrador. O instalador:
   - instala em `C:\Program Files\UniWake` e guarda os dados em `C:\ProgramData\UniWake`
     (acessível só por Administradores e pelo sistema);
   - registra o serviço **UniWake** (início automático, reinicia sozinho se falhar);
   - libera no Firewall do Windows as portas **47100** (painel) e **47101** (cadastro das
     máquinas), só nas redes de domínio e privadas;
   - cria o atalho **UniWake** no menu Iniciar.

Instalação silenciosa (por exemplo, por GPO ou script):

```powershell
.\UniWake-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Instalar uma versão nova por cima mantém banco de dados, configurações e usuários.

Se você mudar as portas em **Configurações** (painel ou cadastro), ajuste também as regras
"UniWake Painel" e "UniWake Cadastro" do Firewall do Windows: o instalador cria as regras só para
as portas padrão.

## Primeiro acesso

1. **No próprio computador do UniWake**, abra o atalho **UniWake** (ou
   <http://127.0.0.1:47100>).
2. Crie o primeiro administrador. Por segurança, essa tela só funciona nesse computador.
3. Cadastre as salas em **Salas** e as máquinas em **Dispositivos** (ou importe uma planilha CSV),
   ou use **Preparar máquinas** para que elas se cadastrem sozinhas.

Perfis: **Administrador** (tudo, inclusive usuários, configurações, logs e backups) e **Operador**
(ligar, agendar, cadastrar máquinas e salas).

### Acesso pela rede (HTTPS)

Por padrão o painel só abre no computador do UniWake. Para abrir de outros computadores, em
**Configurações → Painel**, ligue "Permitir acesso ao painel pela rede", informe o IP deste
computador e reinicie o serviço. O UniWake cria um certificado próprio e o painel passa a abrir em
`https://<IP>:47100`.

O navegador vai avisar que o certificado não é confiável até a TI confiar nele: exporte-o pelo
cadeado do navegador e distribua-o por GPO em "Autoridades de Certificação Raiz Confiáveis", ou
envie em **Configurações** um certificado PFX emitido pela faculdade. Nunca abra o painel por HTTP pela rede: senhas
trafegariam abertas.

## Preparar as máquinas

Em **Preparar máquinas**:

1. Escolha a sala e clique em **Gerar código** (vale 8 horas e até 100 máquinas, por padrão).
2. Copie o comando.
3. Em cada máquina da sala, abra o **PowerShell como Administrador**, cole o comando e pressione
   Enter.

O comando baixa o `prepare-target.ps1` do UniWake, **confere o SHA-256** antes de executar (se
aparecer "Arquivo alterado — não execute", avise a TI) e então:

- permite que a placa cabeada ligue o computador, somente com Magic Packet;
- desativa a Inicialização Rápida (Fast Startup);
- ajusta as propriedades avançadas da placa (Wake on Magic Packet, ligar a partir do desligamento,
  Ethernet com eficiência energética desligada);
- libera o ping (regra `UniWake-ICMPv4-In`, só domínio e privada);
- cadastra a máquina na sala (ou atualiza o cadastro, ou a move de sala).

No fim aparece um resumo (OK / FALHOU / NÃO SE APLICA / MANUAL) e a lista do que conferir na BIOS.
O registro fica em `C:\ProgramData\UniWake-Prepare\`. Para só ver o que mudaria: `-WhatIf`.

**Quando terminar a sala, revogue o código** na lista de códigos: o comando colado fica no
histórico do PowerShell de quem o executou até o código expirar.

A BIOS não pode ser alterada pelo script. Em cada modelo, confira uma vez: Wake on LAN ativado e
ErP/EuP/Deep Sleep desativado (dicas para Dell, HP e Lenovo na própria página e em **Ajuda**).

Para testar uma máquina, abra-a em **Dispositivos** e use **Testar WoL**: o UniWake espera você
desligá-la, aguarda 30 segundos e tenta ligá-la.

## Uso diário

- **Painel**: contadores e salas; clique em uma sala para ligar ou ver as máquinas.
- **Ctrl+K**: ligar rapidamente uma sala, etiqueta ou máquina pelo nome.
- **Agendamentos**: dias, horário, salas/etiquetas; feriados e "Pausar agendamentos" (férias).
- **Histórico**: cada ligação, quem acordou e quem não respondeu (com link para o diagnóstico).
- O "Resultado da manhã" fica fixado no painel até alguém clicar em **Ciente**.

## Atualizações

O UniWake procura versões novas no GitHub a cada 6 horas (veja em **Saúde do sistema**).

- **Automático** (padrão): instala na janela de manutenção (03:00–05:00), nunca com uma ligação em
  andamento ou um agendamento na hora seguinte.
- **Manual**: só avisa; um administrador clica em **Atualizar agora**.

Antes de instalar, o UniWake confere o arquivo baixado (SHA-256), verifica o espaço em disco e faz
um backup. Se a versão nova não responder em 2 minutos, ele volta sozinho para a anterior (e
restaura o banco, se a versão nova o tiver alterado) e avisa no painel. Uma tarefa de segurança
restaura a versão anterior se a atualização for interrompida (por exemplo, falta de energia).

## Backups

- Backup automático diário às 02:30; os últimos 14 são mantidos (configurável).
- Também antes de cada atualização e de cada restauração, e quando você pedir.
- Ficam em `C:\ProgramData\UniWake\backups`. Copie essa pasta para outro lugar periodicamente.
- Para restaurar: **Configurações → Backups**, escolha o backup e digite a data dele para
  confirmar. O serviço reinicia com o banco restaurado.

## Solução de problemas

- **Ajuda** (no menu) explica as causas mais comuns: Inicialização Rápida, BIOS/ErP, energia da
  placa de rede, firewall/ping e redes diferentes. O diagnóstico de cada máquina aponta a página
  certa.
- **Saúde do sistema** mostra agendador, verificações, relógio, backups, atualizações e avisos do
  Windows (suspensão na tomada, reinicialização pendente, horário ativo do Windows Update).
- **Logs** (administradores) mostra o log do serviço. Os arquivos ficam em
  `C:\ProgramData\UniWake\logs`.
- Se o serviço não iniciar (por exemplo, a porta 47100 está em uso por outro programa), o motivo
  aparece no **Visualizador de Eventos → Logs do Windows → Aplicativo**, origem **UniWake**.

### Redes diferentes (VLAN)

Se as máquinas estão em outra rede que o computador do UniWake, o diagnóstico mostra "Dispositivo
em outra sub-rede". Opções: ligar o computador do UniWake também nessa rede, ou informar o
"Broadcast dirigido" da sala (ex.: `10.0.9.255`) e pedir à TI para permitir broadcast dirigido no
roteador.

## Desinstalar

Em **Configurações do Windows → Aplicativos**, desinstale o UniWake. O serviço, as regras de
firewall e o atalho são removidos. Os dados ficam em `C:\ProgramData\UniWake`, a menos que você
escolha removê-los (a desinstalação silenciosa sempre mantém os dados).

## Desenvolvimento

Requisitos: Node 24 (versão em `.nvmrc`) e npm. Código, especificações e commits em inglês; a
interface e este README em português.

```bash
npm ci
npm run dev          # hub em modo demonstração (.dev-data) + painel com recarga automática
npm run verify       # lint, formatação, tipos, testes com cobertura, desempenho, rastreabilidade
npm run e2e          # Playwright contra um hub de demonstração
npm run test:ps      # PSScriptAnalyzer + Pester (Windows)
npm run stage        # monta build/stage (bundle, web, node.exe e WinSW verificados)
```

- O modo demonstração (`--demo`) simula uma rede de laboratórios e **nunca envia pacotes reais**;
  os testes também não usam a rede real.
- Depois de uma restauração de backup, o serviço sai com o código 75 para ser reiniciado pelo
  Windows. Em `npm run dev` ninguém reinicia: rode o comando de novo.
- O instalador (Inno Setup) é gerado e testado no CI (`scripts/ci/`); versões são publicadas ao
  criar uma tag `v*` (`.github/workflows/release.yml`).
- Especificação, plano e decisões em `specs/`; estado atual em `specs/handoff/NEXT.md`.
