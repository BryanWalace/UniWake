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
};

export function HelpIndexPage() {
  return (
    <section className="space-y-4">
      <PageHeader title="Ajuda" />
      <p className="text-sm text-slate-700">
        Por que um computador não liga pela rede, como resolver, e como usar o Modo equipe.
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
