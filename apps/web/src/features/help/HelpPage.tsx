import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { HELP_TOPICS, type HelpTopic } from '@uniwake/shared';
import { EmptyState } from '../../components/Banner';
import { PageHeader } from '../../components/ui';

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="list-decimal space-y-1 pl-5">{children}</ol>
);
const Bullets = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-1 pl-5">{children}</ul>
);
const PrepareLink = () => (
  <Link to="/preparar" className="text-blue-800 underline">
    Preparar máquinas
  </Link>
);

/** Troubleshooting pages (FR-007.5), linked from diagnostics and from error messages. */
export const HELP: Record<HelpTopic, { title: string; summary: string; body: ReactNode }> = {
  'fast-startup': {
    title: 'Inicialização Rápida (Fast Startup)',
    summary:
      'Com ela ligada, o Windows não desliga de verdade e a placa de rede não espera o pacote.',
    body: (
      <>
        <p>
          A Inicialização Rápida faz o Windows hibernar em vez de desligar. Nesse estado muitas
          placas de rede não ficam prontas para receber o Magic Packet, e o computador não liga pela
          rede.
        </p>
        <p>
          O jeito mais simples é executar de novo o comando de <PrepareLink /> no computador: ele
          desativa a Inicialização Rápida. Para fazer à mão:
        </p>
        <Steps>
          <li>Abra o Painel de Controle → Opções de Energia.</li>
          <li>Clique em “Escolher a função dos botões de energia”.</li>
          <li>Clique em “Alterar configurações não disponíveis no momento”.</li>
          <li>Desmarque “Ligar inicialização rápida (recomendado)” e salve.</li>
        </Steps>
        <p>
          Atualizações grandes do Windows às vezes religam essa opção. Quando uma máquina que ligava
          passa a não ligar (“Parou de acordar”), comece por aqui.
        </p>
      </>
    ),
  },
  'bios-erp': {
    title: 'BIOS/UEFI: Wake on LAN e ErP',
    summary: 'A BIOS precisa permitir ligar pela rede e não pode cortar a energia da placa.',
    body: (
      <>
        <p>
          Nenhum script consegue alterar a BIOS. Em cada modelo de computador, confira uma vez
          (normalmente com F2, F10, F1 ou Del ao ligar):
        </p>
        <Bullets>
          <li>Wake on LAN / Power On by PCI-E / Remote Wake Up: ativado.</li>
          <li>
            ErP / EuP / Deep Sleep / economia de energia no desligamento: desativado (essas opções
            cortam a energia da placa de rede).
          </li>
          <li>
            <strong>Dell:</strong> Power Management → Wake on LAN = LAN Only; Deep Sleep Control =
            Disabled.
          </li>
          <li>
            <strong>HP:</strong> Advanced → Power-On Options → Remote Wake Up Boot Source = Remote
            Server; S5 Wake on LAN = Enabled.
          </li>
          <li>
            <strong>Lenovo:</strong> Power → Wake on LAN = Automatic ou Primary; Enhanced Power
            Saving Mode = Disabled.
          </li>
        </Bullets>
        <p>
          Depois de atualizar a BIOS, confira de novo: algumas atualizações voltam aos valores de
          fábrica. Se o computador fica sem energia na tomada (filtro de linha desligado), ele não
          liga pela rede.
        </p>
      </>
    ),
  },
  'nic-power': {
    title: 'Energia da placa de rede',
    summary: 'A placa cabeada precisa ter permissão para ligar o computador com Magic Packet.',
    body: (
      <>
        <p>
          O comando de <PrepareLink /> ajusta tudo isto. Para conferir à mão, no Gerenciador de
          Dispositivos abra Adaptadores de rede → a placa cabeada (Ethernet) → Propriedades:
        </p>
        <Bullets>
          <li>
            Gerenciamento de Energia: marque “Permitir que este dispositivo ative o computador” e
            “Somente permitir que um Magic Packet ative o computador”.
          </li>
          <li>
            Avançado: “Wake on Magic Packet” = Ativado; “Shutdown Wake-On-LAN” ou “Wake from power
            off state” = Ativado; “Energy Efficient Ethernet” e “Green Ethernet” = Desativado.
          </li>
        </Bullets>
        <p>
          Use o MAC da placa cabeada. MACs de Wi-Fi, de máquinas virtuais ou aleatórios (privacidade
          do Wi-Fi) quase nunca ligam o computador.
        </p>
      </>
    ),
  },
  'firewall-icmp': {
    title: 'Firewall e ping (ICMP)',
    summary: 'Sem resposta ao ping, o UniWake não sabe se a máquina está ligada.',
    body: (
      <>
        <p>
          O UniWake descobre se uma máquina está ligada com ping (ICMP) e com conexões às portas
          135, 445 e 3389. Se o Firewall do Windows bloqueia tudo isso, a máquina aparece como
          desligada mesmo ligada (“Nunca respondeu”) e as ligações terminam como “não respondeu”.
        </p>
        <p>
          O comando de <PrepareLink /> cria a regra <code>UniWake-ICMPv4-In</code>, que responde ao
          ping só nas redes de domínio e privadas. À mão, em um PowerShell como Administrador:
        </p>
        <pre
          tabIndex={0}
          aria-label="Comando para liberar o ping"
          className="overflow-x-auto rounded-md bg-slate-100 p-2 text-xs"
        >
          New-NetFirewallRule -Name UniWake-ICMPv4-In -DisplayName &quot;UniWake - Ping
          (ICMPv4)&quot; -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile
          Domain,Private
        </pre>
        <p>
          Se a rede da faculdade estiver marcada como “Pública” no Windows, ou se uma política de
          grupo (GPO) bloquear regras locais, peça à equipe de TI para liberar o ping para o
          computador do UniWake.
        </p>
      </>
    ),
  },
  'vlan-broadcast': {
    title: 'Redes diferentes (VLAN) e broadcast',
    summary: 'O Magic Packet é um broadcast: ele não atravessa roteadores sozinho.',
    body: (
      <>
        <p>
          O UniWake envia o Magic Packet por broadcast a partir das placas de rede deste computador.
          Roteadores não repassam broadcast, então uma máquina em outra rede (outra VLAN ou
          sub-rede) não recebe o pacote. O diagnóstico mostra “Dispositivo em outra sub-rede” quando
          o IP da máquina não pertence a nenhuma placa do UniWake.
        </p>
        <p>Há duas saídas:</p>
        <Bullets>
          <li>
            Ligar o computador do UniWake também na rede dessas máquinas (outra placa ou porta de
            switch configurada para aquela VLAN).
          </li>
          <li>
            Usar broadcast dirigido: informe o endereço de broadcast da rede da sala (ex.:
            10.0.9.255) em Salas → editar → “Broadcast dirigido”, e peça à TI para permitir
            broadcast dirigido no roteador dessa rede.
          </li>
        </Bullets>
        <p>
          Se aparecer “Nenhuma placa de rede disponível”, o computador do UniWake está sem rede:
          confira o cabo e, em Configurações, quais placas o UniWake usa para enviar.
        </p>
      </>
    ),
  },
  'team-mode': {
    title: 'Modo equipe: dois ou mais PCs da TI com o mesmo cadastro',
    summary:
      'Pareie os PCs da equipe; eles sincronizam pela rede local e só um executa cada agendamento.',
    body: (
      <>
        <p>
          Não existe servidor ligado o tempo todo: cada pessoa da TI usa o UniWake no próprio PC. No
          Modo equipe esses PCs mantêm o mesmo cadastro (salas, máquinas, etiquetas, agendamentos,
          exceções, usuários e configurações gerais) e trocam as alterações sempre que estão ligados
          ao mesmo tempo.
        </p>
        <h2 className="text-lg font-bold">Como parear</h2>
        <Steps>
          <li>
            No PC que já tem o cadastro, abra{' '}
            <Link to="/equipe" className="text-blue-800 underline">
              Modo equipe
            </Link>{' '}
            e clique em “Gerar código de pareamento”. Aparece um código de 6 dígitos, válido por 5
            minutos.
          </li>
          <li>
            No outro PC, abra Modo equipe › “Entrar em uma equipe”, escolha o PC na lista (ou digite
            o endereço dele) e digite o código.
          </li>
          <li>
            Se o PC que entra já tinha cadastro, ele é substituído pelo da equipe (um backup é feito
            antes) e é preciso digitar SUBSTITUIR para confirmar. Depois, use os usuários e senhas
            da equipe.
          </li>
        </Steps>
        <p>
          O código nunca passa pela rede: ele só serve para os dois PCs provarem um ao outro que
          viram o mesmo número. Errou 5 vezes, o código é cancelado.
        </p>
        <h2 className="text-lg font-bold">O que é sincronizado</h2>
        <Bullets>
          <li>
            Sim: salas, máquinas, etiquetas, agendamentos, exceções, pausa, usuários, configurações
            gerais.
          </li>
          <li>
            Não: configurações marcadas “Somente neste PC” (placas de rede, endereço do painel,
            atualização, backup, portas), histórico, ligações, logs, auditoria, backups.
          </li>
          <li>
            Se o mesmo item for alterado em dois PCs antes de sincronizarem, vale a alteração mais
            recente; o caso aparece em “Conflitos resolvidos”.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Agendamentos</h2>
        <p>
          Entre os PCs ligados, um só executa cada agendamento; se ele não executar em 90 segundos,
          outro executa. Um PC que liga depois do horário não executa sozinho o que perdeu: ele
          mostra “Agendamento não executado” com o botão “Ligar agora”, caso nenhum outro PC tenha
          executado.
        </p>
        <p>
          Para a ligação da manhã funcionar sem ninguém por perto, deixe pelo menos um PC da equipe
          ligado nesse horário ou configure na BIOS dele “Power On by RTC” (ligar em horário
          programado) alguns minutos antes do primeiro agendamento.
        </p>
        <h2 className="text-lg font-bold">Rede e firewall</h2>
        <Bullets>
          <li>
            Os PCs conversam pela porta 47102 (TCP e UDP). O instalador libera essa porta no
            Firewall do Windows para redes de Domínio e Privadas.
          </li>
          <li>
            PCs na mesma rede se encontram sozinhos. Se um PC estiver em outra sub-rede, edite-o em
            Modo equipe e informe um “Endereço fixo” (nome do computador ou IP).
          </li>
          <li>
            “Sem conexão” na lista: o outro PC está desligado, o UniWake não está rodando nele ou a
            porta 47102 está bloqueada (antivírus ou política do domínio).
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Remover um PC</h2>
        <p>
          “Remover da equipe” troca a chave da equipe. Os PCs que estavam desligados recebem a chave
          nova quando ligarem; o PC removido não sincroniza mais.
        </p>
      </>
    ),
  },
  'remote-shutdown': {
    title: 'Desligar computadores',
    summary:
      'Como o UniWake desliga e reinicia as máquinas, o aviso para quem está usando e o que fazer quando uma não desliga.',
    body: (
      <>
        <p>
          O UniWake não entra nos computadores pela rede para desligá-los. Cada máquina preparada
          tem uma tarefa agendada do Windows (“UniWake”) que, a cada minuto, pergunta ao UniWake se
          há algo a fazer. Ela também guarda os desligamentos agendados dos próximos 14 dias e os
          executa no horário mesmo que nenhum PC da TI esteja ligado.
        </p>
        <h2 className="text-lg font-bold">Preparar uma máquina</h2>
        <Steps>
          <li>
            Em <PrepareLink />, copie o comando e execute-o na máquina, em um PowerShell como
            Administrador. Máquinas preparadas antes da versão 1.3 precisam do comando atualizado.
          </li>
          <li>
            O comando cria três tarefas (“UniWake”, “UniWake Despertar” e “UniWake Aviso”), a pasta{' '}
            <code>C:\ProgramData\UniWake</code> (só Administradores e o sistema podem alterá-la) e
            ativa os temporizadores de ativação do plano de energia (na tomada).
          </li>
          <li>
            Em Dispositivos, a máquina passa a mostrar “Pronta para desligar”. Na página da máquina,
            o quadro “Desligamento remoto” mostra a última consulta, a versão e o congelamento.
          </li>
        </Steps>
        <h2 className="text-lg font-bold">Desligar ou reiniciar agora</h2>
        <p>
          Use “Desligar” ou “Reiniciar” na página da sala, da máquina ou com várias máquinas
          selecionadas. Antes de confirmar, o UniWake mostra quantas máquinas recebem a ordem,
          quantas têm alguém usando e quais ainda precisam do novo preparo. O aviso padrão é de 1
          minuto, sem adiamento; também dá para escolher 5 minutos com adiamento. A máquina recebe a
          ordem na próxima consulta (até 1 minuto). Uma ordem que nenhuma máquina buscou em 2 horas
          expira.
        </p>
        <h2 className="text-lg font-bold">Agendar desligamentos</h2>
        <p>
          Em Agendamentos, escolha a Ação “Desligar”. Para não desligar certas máquinas (a do
          professor, por exemplo), marque nelas “Nunca desligar por agendamento” ou exclua uma
          etiqueta no agendamento. Uma máquina que estava em suspensão no horário acorda sozinha
          (temporizador de ativação) e desliga; se acordar mais de 60 minutos atrasada, ou depois do
          próximo “Ligar”, ela não desliga e o Histórico mostra “Pulado: acordou … min após o
          horário”.
        </p>
        <h2 className="text-lg font-bold">O aviso para quem está usando</h2>
        <Bullets>
          <li>
            Aparece uma janela: “Este computador será desligado às … pela equipe de TI. Salve seus
            arquivos: o que não for salvo será perdido.” O texto pode ser alterado em Configurações.
          </li>
          <li>
            Nos agendamentos, a pessoa pode adiar (por padrão 2 vezes, de 15 minutos). Quando os
            adiamentos acabam, o computador desliga.
          </li>
          <li>
            Se a janela não puder ser mostrada, o Windows mostra o aviso próprio dele, sem a opção
            de adiar. Sem ninguém logado, o computador desliga em 30 segundos.
          </li>
          <li>
            O UniWake registra apenas se havia alguém logado e quantas sessões. Nunca guarda nomes
            de usuários.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Quando uma máquina não desliga</h2>
        <Bullets>
          <li>
            “Precisa do novo preparo”: execute nela o comando atualizado de <PrepareLink />.
          </li>
          <li>
            “Desligamento remoto perdido”: a máquina responde na rede há 15 minutos sem consultar o
            UniWake. Confira no Agendador de Tarefas se a tarefa “UniWake” existe e está ativa, se o
            antivírus bloqueou o PowerShell e se a máquina não está congelada (veja “Laboratórios
            com Deep Freeze ou similar”). Executar o comando de preparo de novo resolve a maioria
            dos casos.
          </li>
          <li>
            “Não confirmou”: a ordem foi executada, mas a máquina continuou respondendo na rede.
            Alguém pode ter cancelado o desligamento ou um programa impediu o Windows de desligar.
          </li>
          <li>
            Relógio da máquina muito errado: o UniWake corrige a diferença a cada consulta, mas
            acerte o horário do Windows (sincronização com o domínio) para evitar surpresas.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Revogar ou remover</h2>
        <p>
          Na página da máquina, um administrador pode usar “Revogar desligamento remoto”: a máquina
          deixa de receber ordens e agendamentos de desligar e continua sendo ligada normalmente.
          Para tirar também as tarefas e arquivos, baixe o <code>prepare-target.ps1</code> em{' '}
          <PrepareLink /> e execute <code>.\prepare-target.ps1 -RemoveAgent</code> como
          Administrador.
        </p>
      </>
    ),
  },
  'backup-migration': {
    title: 'Backup e migração',
    summary:
      'Leve o cadastro para um PC novo, guarde uma cópia fora deste computador e restaure depois de reinstalar.',
    body: (
      <>
        <p>
          Em <strong>Backup e migração</strong> (administradores) o UniWake gera um arquivo{' '}
          <code>.uniwake</code> com as partes que você escolher: Cadastro (salas, etiquetas e
          máquinas), Agendamentos, Configurações gerais, Usuários, Desligamento remoto e, se quiser,
          o Histórico. As configurações deste PC (placas de rede, endereços, portas, atualização e
          backup) nunca vão no arquivo.
        </p>
        <h2 className="text-lg font-bold">Senha</h2>
        <p>
          Usuários (com as senhas deles) e Desligamento remoto (a chave deste UniWake) só saem no
          arquivo com uma senha de pelo menos 10 caracteres. Sem a senha ninguém abre essas partes:
          guarde-a junto com a documentação da TI. Um arquivo sem senha pode ficar numa pasta da
          rede sem risco para as senhas dos usuários.
        </p>
        <h2 className="text-lg font-bold">Passar para um PC novo</h2>
        <Steps>
          <li>
            No PC antigo: Exportar com todas as partes e uma senha. Copie o arquivo para o PC novo.
          </li>
          <li>Instale o UniWake no PC novo e crie o primeiro usuário.</li>
          <li>
            Importar → escolha o arquivo → digite a senha → <strong>Substituir</strong> → Ver prévia
            → digite IMPORTAR. Antes de importar o UniWake faz um backup, e dá para desfazer.
          </li>
          <li>
            Entre de novo com um usuário do arquivo. O PC novo fica <strong>em espera</strong>: os
            agendamentos não rodam e as máquinas dos laboratórios não recebem ordens dele.
          </li>
          <li>
            Confira tudo, desligue o UniWake do PC antigo e clique em{' '}
            <strong>Ativar este UniWake</strong>.
          </li>
        </Steps>
        <p>
          Se o PC novo tiver outro endereço na rede, rode de novo o comando de <PrepareLink /> nas
          máquinas dos laboratórios para que elas passem a consultar o PC novo.
        </p>
        <h2 className="text-lg font-bold">Mesclar ou substituir</h2>
        <Bullets>
          <li>
            <strong>Mesclar</strong> junta o arquivo ao que já existe; nada é apagado e vale a
            versão mais recente de cada item. Nomes ou MACs repetidos aparecem na prévia como
            conflitos.
          </li>
          <li>
            <strong>Substituir</strong> deixa o cadastro e os agendamentos iguais aos do arquivo; o
            histórico local das máquinas que continuam é mantido.
          </li>
          <li>
            Um PC que está num Modo equipe não importa: importe num PC fora da equipe e depois
            pareie.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Exportação automática</h2>
        <p>
          Em Configurações você pode ligar uma exportação diária para uma pasta, inclusive numa
          pasta compartilhada da rede (<code>\\servidor\pasta</code>). Ela não leva Usuários nem
          Desligamento remoto. O serviço do UniWake roda como Sistema Local: na pasta da rede, quem
          precisa de permissão de escrita é a conta do computador (por exemplo,{' '}
          <code>DOMINIO\PC-TI$</code>). Falhas aparecem em Saúde do sistema.
        </p>
      </>
    ),
  },
  antivirus: {
    title: 'Antivírus e o agente do UniWake',
    summary:
      'Quando o antivírus bloqueia ou apaga um arquivo do agente, a máquina para de receber agendamentos e ordens de desligar.',
    body: (
      <>
        <p>
          O agente do UniWake são dois scripts do PowerShell na pasta{' '}
          <code>C:\ProgramData\UniWake\agent</code>, rodados pelas tarefas agendadas "UniWake",
          "UniWake Despertar", "UniWake Aviso" e "UniWake Reparo". Alguns antivírus desconfiam de
          scripts que rodam como sistema e bloqueiam ou apagam esses arquivos.
        </p>
        <h2 className="text-lg font-bold">Como o UniWake avisa</h2>
        <Bullets>
          <li>
            O Microsoft Defender informa o que pegou: o painel mostra o arquivo, o nome da ameaça e
            quando.
          </li>
          <li>
            Outros antivírus não têm uma consulta padrão: o agente percebe o efeito (a gravação foi
            recusada ou o arquivo sumiu logo depois de gravado) e diz qual antivírus está instalado.
          </li>
          <li>
            A tarefa "UniWake Reparo" restaura um arquivo apagado a partir de uma cópia conferida e
            avisa o painel. Se nem a cópia existir, ela avisa que é preciso preparar a máquina de
            novo.
          </li>
          <li>
            Os avisos aparecem no painel inicial, na lista de Dispositivos ("Agente bloqueado") e na
            página da máquina.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">O que fazer</h2>
        <Steps>
          <li>
            No console do antivírus, libere a pasta <code>C:\ProgramData\UniWake</code> (e a pasta
            persistente, se usar uma) ou os arquivos <code>uniwake-agent.ps1</code> e{' '}
            <code>uniwake-aviso.ps1</code>.
          </li>
          <li>
            Restaure da quarentena o que foi pego, ou espere: em até 30 minutos o "UniWake Reparo"
            restaura da cópia, e o agente baixa de novo do UniWake na próxima consulta.
          </li>
          <li>
            Confira na página da máquina: "Última atualização do agente" deve dizer "atualizado" e
            não deve haver bloqueios novos.
          </li>
        </Steps>
        <p>
          O UniWake nunca cria exceções no antivírus sozinho: liberar uma pasta é uma decisão de
          segurança da equipe de TI.
        </p>
      </>
    ),
  },
  'frozen-labs': {
    title: 'Laboratórios com Deep Freeze ou similar',
    summary:
      'Em máquinas que desfazem as alterações ao reiniciar, o desligamento agendado precisa de uma pasta preservada.',
    body: (
      <>
        <p>
          Programas como Deep Freeze, Reboot Restore Rx, Shadow Defender e o Filtro de Gravação
          Unificado (UWF) do Windows desfazem tudo o que foi alterado quando a máquina reinicia. O
          UniWake detecta esses programas e mostra na página da máquina: “Congelamento: não
          detectado”, “detectado (congelada)”, “detectado (descongelada)” ou “detectado (estado não
          verificado)”.
        </p>
        <h2 className="text-lg font-bold">Preparar uma máquina congelada</h2>
        <Steps>
          <li>Descongele a máquina (Thawed / modo manutenção) e reinicie.</li>
          <li>
            Execute o comando de <PrepareLink />. Se a máquina estiver congelada, o resumo avisa: as
            tarefas funcionam só até o próximo reinício.
          </li>
          <li>Congele de novo.</li>
        </Steps>
        <h2 className="text-lg font-bold">O que muda com a máquina congelada</h2>
        <p>
          A tarefa busca a agenda a cada vez que a máquina liga, então o desligamento agendado
          funciona sempre que a máquina consegue falar com o UniWake depois de ligar. Sem uma pasta
          preservada, a agenda e os relatórios guardados se perdem a cada reinício:{' '}
          <strong>
            o desligamento agendado depende de a máquina ter falado com o UniWake depois do último
            reinício
          </strong>
          . Os relatórios perdidos aparecem no Histórico como “Provavelmente desligou (sem
          relatório)” quando a máquina sumiu da rede perto do horário.
        </p>
        <h2 className="text-lg font-bold">Usar uma pasta preservada</h2>
        <Bullets>
          <li>
            Deep Freeze: crie uma área ThawSpace (por exemplo, a unidade T:). Em <PrepareLink />,
            abra “Laboratório com Deep Freeze ou similar”, informe <code>T:\UniWake</code> em “Pasta
            persistente” e clique em “Atualizar comando”.
          </li>
          <li>
            Use uma pasta nova, só do UniWake: o preparo deixa a pasta acessível apenas para
            Administradores e o sistema. Por isso o UniWake recusa pastas do Windows (como Windows,
            Users ou ProgramData) e pastas que já têm outros arquivos.
          </li>
          <li>
            UWF: marque “Excluir a pasta do agente do Filtro de Gravação Unificado (UWF)”. A
            exclusão vale depois do próximo reinício.
          </li>
          <li>
            Deep Freeze: o estado “congelada/descongelada” é lido pelo programa de linha de comando
            do Deep Freeze quando ele está disponível; sem ele, aparece “estado não verificado”.
          </li>
        </Bullets>
        <h2 className="text-lg font-bold">Ligar continua igual</h2>
        <p>
          O congelamento não afeta o Wake on LAN: ligar pela rede depende só da BIOS e da placa de
          rede.
        </p>
      </>
    ),
  },
};

export function HelpIndexPage() {
  return (
    <section className="space-y-4">
      <PageHeader title="Ajuda" />
      <p className="text-sm text-slate-700">
        Por que um computador não liga pela rede, como resolver, como desligar computadores pelo
        UniWake e como usar o Modo equipe.
      </p>
      <ul className="space-y-3">
        {HELP_TOPICS.map((topic) => (
          <li key={topic} className="rounded-lg border border-slate-200 bg-white p-4">
            <Link to={`/ajuda/${topic}`} className="font-semibold text-blue-800 underline">
              {HELP[topic].title}
            </Link>
            <p className="text-sm text-slate-700">{HELP[topic].summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HelpPage() {
  const topic = useParams().topico as HelpTopic | undefined;
  const page = topic && (HELP_TOPICS as readonly string[]).includes(topic) ? HELP[topic] : null;
  if (!page) {
    return (
      <EmptyState title="Página de ajuda não encontrada">
        <Link to="/ajuda" className="text-blue-800 underline">
          Ver todas as páginas de ajuda
        </Link>
      </EmptyState>
    );
  }
  return (
    <article className="max-w-3xl space-y-4">
      <nav aria-label="Trilha" className="text-sm">
        <Link to="/ajuda" className="text-blue-800 underline">
          Ajuda
        </Link>{' '}
        / {page.title}
      </nav>
      <PageHeader title={page.title} />
      <div className="space-y-3 text-sm leading-relaxed">{page.body}</div>
    </article>
  );
}

/** "Como resolver" link to a help page (FR-007.5). */
export function HelpLink({ topic, children }: { topic: HelpTopic; children?: ReactNode }) {
  return (
    <Link to={`/ajuda/${topic}`} className="font-semibold text-blue-800 underline">
      {children ?? `Como resolver: ${HELP[topic].title}`}
    </Link>
  );
}
