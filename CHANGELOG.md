# Histórico de versões

Todas as versões abaixo foram feitas e publicadas em 06/11/2026. A versão fica em `js/config.js` (`APP_VERSION`) e em `sw.js` (`VERSION`).

## 1.4.1

- **Microfone no app da Tela de Início do iPhone**: o app passa a tentar o reconhecimento de voz do navegador também nesse modo (o iOS, até onde se sabe, não permite). Se o iPhone recusar ou ficar mudo, o app avisa, lembra por 7 dias neste aparelho e leva ao microfone do teclado, com o link "Tentar o microfone do app de novo".
- Limites de tempo no microfone: depois de tocar para parar, espera até 3 segundos; ouve no máximo 30 segundos.
- Guias para continuar o desenvolvimento em outro computador: `docs/DESENVOLVIMENTO.md`, `CLAUDE.md` e este arquivo.

## 1.4.0

- **Lembretes** ("despertador"): numa tarefa com data e hora, escolha ser avisado na hora, 5, 10, 15, 30 minutos, 1 hora, 2 horas ou 1 dia antes (ou outro valor, escrevendo `me avise 45 minutos antes`). Linha "Lembrete" no editor, sino na lista, coluna "Lembrete" no CSV.
- **Voz**: botão de microfone ao lado de Adicionar. Entende frases como "quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas, me avise 15 minutos antes", cria a tarefa e mostra o que entendeu, com Desfazer.
- **Avisos com o app aberto** (na tela ou como notificação) e **com o app fechado** por um serviço na Cloudflare (Worker, banco D1 e relógio de 1 minuto, Web Push sem conteúdo). O serviço só recebe os horários, nunca os títulos. Configurações, "Avisos dos lembretes": ligar, desligar, testar agora e testar com o app fechado.
- Notificação toca na tarefa: o app abre no editor dela.
- Guia: `docs/LEMBRETES.md`.

## 1.3.0

- Criar conta: campo "Confirmar senha", com aviso na hora quando as senhas não batem.

## 1.2.0

- Cadastro aberto: quem tiver o endereço do site cria a conta, sem código de convite (as regras do banco, `docs/regras-banco-aberto.json`, foram trocadas). O modo com código continua documentado.

## 1.1.0

- Login obrigatório: o app só abre para quem entrou numa conta (a tela de entrada vem antes de qualquer tarefa).

## 1.0.0

- Primeira versão: agenda do dia, adicionar rápido em português, prioridades, etiquetas, checklist, anotações, repetição, calendário, próximos dias, pendentes, concluídas, busca, backup e CSV, tema claro e escuro, instalável e offline.
- Login e sincronização opcionais pelo Firebase (por REST, sem SDK), com guia em `docs/NUVEM.md`, regras do banco e um emulador local.
