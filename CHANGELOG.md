# Histórico de versões

As versões 1.0.0 a 1.4.1 foram feitas e publicadas em 06/11/2026; a 1.5.0 e a 1.6.0, em 09/11/2026. A versão fica em `js/config.js` (`APP_VERSION`) e em `sw.js` (`VERSION`).

## 1.6.0

- **Entender a fala com IA (opcional, desligada por padrão)**: em **Configurações > Entender a fala com IA**, cada aparelho escolhe. Ligada, a frase falada (só o texto) vai ao serviço do Pauta na Cloudflare, que pede a uma IA (Workers AI, Llama 3.3 70B) para reescrevê-la como tarefa: título limpo, dia, hora, lembrete, prioridade, etiqueta, repetição, correções ("às 16, não, às 17"). Vale para o microfone do app e para o ditado do teclado (iPhone); texto digitado nunca vai. O serviço não guarda nem registra a frase.
- A resposta da IA não é aceita às cegas: passa pelo mesmo analisador das frases digitadas; o que ela inventou (um dia ou hora que você não disse) é descartado, o que você disse e ela deixou cair volta, e a dúvida dela abre a janela **Nova tarefa**. Se a IA falhar (sem internet, sem login, limite do dia, serviço fora do ar, demora), o app avisa e usa as regras do aparelho.
- Botão **Testar a IA** nas Configurações: mostra como a IA entendeu uma frase de exemplo, ou o motivo de não ter dado.
- Serviço da Cloudflare: nova rota `POST /interpretar` (confere o login do Firebase com as chaves públicas do Google, limita 40 pedidos por hora e 150 por dia por pessoa), tabela `ia_uso` (só contadores), `/health` informa `"ia"`; precisa do binding `AI` (Workers AI). Guia em `docs/LEMBRETES.md`.
- Corrigido no analisador de frases: o texto de um item reconhecido (como "às 15:00") podia engolir os itens vizinhos já recortados ("!alta #etiqueta").
- Testes: 290 -> 320 (novos: `ai`, login do Firebase com chave RSA de verdade, limites, resposta da IA).

## 1.5.0

- **Hora com minutos de 5 em 5**: na janela da tarefa, a hora são duas caixas (hora e minutos: 00, 05, 10, 15...). Se a tarefa já tem um minuto "quebrado" (14:07, de uma frase digitada), ele continua aparecendo até você escolher outro.
- **O microfone ouve até você mandar parar**: toque nele de novo ou aperte Enter. Pausas no meio da frase não cortam mais a gravação (o app volta a ouvir sozinho e junta tudo). Para sozinho só depois de 45 segundos sem ouvir uma palavra ou 3 minutos no total. Se você começar a digitar durante a gravação, o microfone sai da frente.
- **Entende a fala como uma pessoa, no próprio aparelho (o texto não é enviado a nenhum serviço do Pauta)**: tira as hesitações ("hum", "então", "né", palavras repetidas) e o pedido ("quero criar uma tarefa", "anota aí", "tarefa:"); "preciso comprar leite" vira "Comprar leite" e "tenho reunião com o cliente" vira "Reunião com o cliente"; entende "às oito", "às quatro e vinte", "dia primeiro", "daqui a 20 minutos", "em duas horas", "é urgente", "me avise quinze minutos antes" e correções como "às 16, quer dizer, às 17" (vale a última).
- **Quando não fica claro, o app não chuta**: se faltar o título, a hora ou a data não puderem ser lidas, o lembrete for pedido sem hora, a hora de hoje já tiver passado ou o áudio estiver pouco claro, abre a janela **Nova tarefa** (a mesma da edição) com o que foi entendido já preenchido, o resto em branco, o que ficou em dúvida e o que você disse. O pedido de lembrete espera: ao escolher a hora, ele liga sozinho. **Adicionar** cria a tarefa; fechar a janela descarta, com **Desfazer**. Quando tudo fica claro, a tarefa é criada direto, como antes.
- Por dentro: `js/voice.js` ganhou `interpretSpoken` (a tarefa entendida e a lista de dúvidas); `js/model.js` ganhou `mergePatch` (a regra de edição compartilhada entre a tarefa e o rascunho); novo `js/ui/timepick.js`.

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
