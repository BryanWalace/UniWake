# Política de segurança

O UniWake roda como serviço do Windows com privilégios de sistema e controla computadores de uma
instituição inteira. Levamos falhas de segurança a sério.

## Como relatar uma vulnerabilidade

**Não abra uma issue pública, discussão ou pull request descrevendo a falha.** Use o relato privado
do GitHub:

1. Acesse <https://github.com/BryanWalace/UniWake/security/advisories/new>
   (aba **Security** do repositório › **Report a vulnerability**).
2. Descreva o problema, a versão do UniWake, como reproduzir e o impacto que você imagina.
3. Não inclua IPs, MACs, nomes de computadores, senhas ou tokens reais da sua instituição; use
   exemplos.

Só quem mantém o projeto vê o relato. Você recebe uma resposta inicial em até **7 dias**, e
combinamos juntos quando e como a correção e o aviso serão publicados. Pedimos que não divulgue a
falha antes da versão corrigida estar disponível.

## O que é considerado vulnerabilidade

Exemplos do que queremos saber:

- acesso ao painel ou à API sem login, ou um operador fazendo o que só administradores podem;
- execução de comandos no PC do UniWake ou nos computadores preparados com `prepare-target.ps1`;
- falhas no cadastro das máquinas (porta 47101) ou no Modo equipe (porta 47102): pareamento sem o
  código, sincronização sem a chave da equipe, PC removido que continua recebendo dados;
- atualização automática instalando algo que não veio das versões oficiais;
- vazamento de senhas, chaves da equipe, códigos de cadastro ou dados em logs e backups.

Não são vulnerabilidades: Wake-on-LAN em si (o protocolo não tem autenticação, por definição),
alguém com acesso de administrador ao Windows do PC do UniWake, ou problemas que exigem desligar
recursos de segurança do próprio UniWake.

## Versões com correções

Correções de segurança saem na versão mais recente publicada em
[Releases](https://github.com/BryanWalace/UniWake/releases). O UniWake se atualiza sozinho dentro da
janela de manutenção (padrão 03:00–05:00); mantenha a atualização automática ligada.
