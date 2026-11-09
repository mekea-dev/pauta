# Histórico de versões

As versões 1.0.0 a 1.4.1 foram feitas e publicadas em 06/11/2026; da 1.5.0 à 1.9.0, em 09/11/2026. A versão fica em `js/config.js` (`APP_VERSION`) e em `sw.js` (`VERSION`).

## 1.9.0

- **Alarme** (pedido do dono: "um tipo de alarme, que nem um despertador, que só desativa e para de tocar e vibrar se clicar em parar ou adiar"): um lembrete que **toca como despertador**.
  - Na tarefa (com data e hora), ligue **Tocar como alarme**, na linha do **Lembrete** (se a tarefa não tinha lembrete, ele liga "na hora"; com "15 minutos antes", o alarme toca nesse horário). Ou escreva ou fale: `Acordar amanhã 6h com alarme`, `Reunião sexta 14h alarme 15 minutos antes`, `Alarme às 7h`, `coloca um alarme para acordar às 6`. **Alarme** e **despertador** ligam o alarme; **me avise** e **lembrete** continuam sendo só notificação. A lista mostra "alarme" com um despertador no lugar do sino, e o alarme vai no backup (planilha: "Alarme na hora", "Alarme 15 minutos antes").
  - **Com o app aberto**, na hora, uma **tela do alarme** cobre o app (até um diálogo que estivesse aberto) com o horário grande, o título e quatro botões: **Parar**, **Adiar 5 min**, **Adiar 10 min** e **Concluir a tarefa**. O Esc não fecha. O som (quatro bipes e uma pausa, sem parar), a vibração (Android) e a tela acesa seguem até você escolher; se ninguém mexer, o som para sozinho em 30 minutos. **Adiar** volta a tocar no próximo minuto cheio depois do prazo. Aba escondida: além da tela, uma notificação do sistema.
  - **Com o app fechado**, o serviço de lembretes dá **um toque por minuto, 10 vezes**, e cada toque mostra a notificação do alarme de novo (fica na tela até você tocar, no computador e no Android). Tocar nela abre o app na tela do alarme. **Parar** ou **Adiar** corta os toques que faltam. **O serviço da Cloudflare não mudou** (não é preciso colar o `worker/lembretes.js` nem fazer Deploy): o app manda 10 horários seguidos por alarme, e cada alarme gasta 10 dos 100 horários que o serviço guarda por aparelho.
  - Em **Configurações > Avisos dos lembretes**, **Ouvir o alarme** mostra a tela e toca o som sem mexer em nenhuma tarefa (para conferir o volume e o som no aparelho).
  - **Limites** (é um site, não o relógio do aparelho): sem som contínuo nem botões na notificação com o app fechado; o som pode ficar mudo com o aparelho no silencioso ou com um Foco ligado, e o navegador só libera o som depois de um toque seu na tela (a tela avisa); a vibração é só no Android; **Parar e Adiar valem só no aparelho onde foram feitos**; **Parar não conclui a tarefa**. Desligar os avisos neste aparelho desliga os alarmes dele. **Nenhuma notificação de alarme chegou de verdade em um aparelho ainda; o iPhone nunca foi testado.**
- **Campo de adicionar mais limpo** (pedido do dono: o "+" ao lado do microfone era redundante): o botão **Adicionar** saiu. No computador, clique na linha, digite e aperte **Enter**; no celular, o **+ flutuante** leva ao campo e a tecla de enviar do teclado faz o mesmo (`enterkeyhint="send"`). O recado "Parei de ouvir" (o microfone parou sozinho) ganhou o link **Criar a tarefa**, no lugar do pedido para tocar em Adicionar, e as outras mensagens que mandavam tocar em Adicionar agora dizem Enter. O "+" decorativo à esquerda do campo ficou. Antes, durante o "Entendendo com IA…", o botão desabilitado impedia o Enter de pular a IA; agora o Enter de novo pula, como o guia dizia.
- **Instalar: o botão "Como instalar"** (trabalho da sessão do cadastro, junto nesta versão): quando o navegador não oferece o botão Instalar, o bloco no alto da tela de entrada mostra **Como instalar**, que abre o passo a passo (computador, Android, janela anônima, "já instalou? abra pelo ícone") com **Copiar endereço** (para colar numa janela normal; se o navegador não deixar copiar, o endereço aparece selecionado). No iPhone com Chrome, Edge ou Firefox o texto acrescenta "Se a opção não aparecer neste navegador, abra este endereço no Safari". O bloco tem a mesma altura com o botão ou com a dica.
- Por dentro: `js/alarm.js` (as contas, o estado parado/adiado), `js/alarm-sound.js` (som, vibração, tela acesa), `js/ui/alarm.js` (a tela), `reminderEntries` e `remindDescribe` em `js/reminders.js`, `alerts.checkAlarms`, `stopAlarm` e `snoozeAlarm`, `res.alarm` no parser, ícone `alarm-clock`.
- Testes: 381 -> 421 (novos: `alarm` e os de alarme em `alerts` e `sw`; o `install` ganhou 2 na sessão do cadastro).

## 1.8.1

- **A tela de entrada sempre diz como instalar** (relato do dono: abriu o site numa janela anônima do Chrome e não viu o botão): quando o navegador não oferece o botão **Instalar** (janela anônima, Firefox, ou o Pauta já instalado e aberto numa aba), o bloco no alto da tela de entrada e de criar conta mostra a dica "No Chrome ou Edge, use o ícone de instalar na barra de endereço, numa janela normal (não anônima)". Depois de instalar (aceitando o pedido ou pelo ícone da barra de endereço), o bloco some e a dica não volta. Ele só não aparece quando o Pauta já está aberto como aplicativo.
- Configurações: quando já está instalado, a seção "Instalar como aplicativo" diz "O Pauta já está instalado neste aparelho." (vale para o app aberto como aplicativo e para quem acabou de instalar naquela aba).
- Por dentro: `app.installed` (marcado por `installNow` quando a pessoa aceita e pelo `appinstalled` de `js/main.js`) e `BROWSER_HELP`, em `js/ui/install.js`.
- Testes: continuam 381 (os de `install` ganharam a marca de instalado e a dica).

## 1.8.0

- **O microfone só envia quando você manda** (relato do dono com a 1.7.0: "quando eu paro de falar, ele já envia"). Ele ouve até você tocar em **Parar e enviar**, tocar no microfone de novo ou apertar Enter; pausar não envia. No iPhone voltou o modo contínuo (a 1.7.0 ouvia uma frase por vez e terminava na primeira pausa). Se o app parar de ouvir **sozinho** (45 segundos sem uma palavra, 3 minutos no total, ou o navegador não deixar voltar a ouvir), ele **não envia**: o texto fica no campo, com o aviso "Parei de ouvir" e o botão **continue falando**; tocar no microfone continua a frase de onde parou. Se o navegador zerar a lista de trechos no meio da frase (relato do iOS 18.0), o que já foi dito não se perde.
- **A IA agora resume e descreve** (relato do dono: "só está criando a demanda pelo que eu falo, sem título resumido e descrição"). Numa frase longa a IA devolve um **título curto** com as palavras que você disse e põe o resto em **Anotações** da tarefa ("Ligar para o seu José do financeiro amanhã de manhã", com a anotação "Ele precisa mandar o boleto da faculdade."). Continua só com o que você falou: título e anotação com palavra que ninguém disse são descartados (vale o título das regras).
- **Comandos de voz em tarefas que já existem** (pedido do dono): "já paguei a conta de luz desse mês" **conclui**, "muda a reunião de sexta para segunda às três da tarde" **altera** e "apaga a tarefa do dentista" **exclui**. A IA só diz o que você quer e como chamou a tarefa; **quem acha a tarefa é o seu aparelho** (os títulos das suas tarefas não saem dele). Concluir é direto, com **Desfazer**; alterar e excluir pedem confirmação; se mais de uma tarefa combina, o app pergunta qual; se nenhuma combina, ele avisa e não faz nada. Sem a IA (desligada, sem internet), a frase vira uma tarefa nova, como antes.
- **Arrastar a tarefa (celular):** arraste a linha para a direita para concluir (ou reabrir, se já estiver concluída) e para a esquerda para excluir. Só vale se você arrastar e soltar depois do limite (cerca de 35% da largura da linha, entre 90 e 140 px): soltar antes volta ao lugar, e um toque ou a rolagem da lista não fazem nada. O aviso traz **Desfazer**, e a tela redesenhando no meio do arrasto não derruba o gesto.
- **A conta nova começa zerada** (pedido do dono): sem tarefas nem etiquetas de exemplo. Aparelhos antigos que ainda tinham só os exemplos também não os levam mais para a conta nova.
- **Instalar no topo do cadastro** (pedido do dono): a tela de entrada e de criar conta mostra, no alto, "Instalar o Pauta no seu aparelho": o botão **Instalar** quando o navegador oferece, ou o passo a passo (Compartilhar, Adicionar à Tela de Início) no iPhone e no iPad; se o Pauta já está aberto como aplicativo, não aparece nada. As Configurações usam o mesmo ajudante (`js/ui/install.js`) e passam a dizer que o app já está instalado quando for o caso.
- **Sem botões de teste de aviso** (o dono confirmou que as notificações deram certo): saíram **Testar agora** e **Testar com o app fechado** de Configurações > Avisos dos lembretes, e o aviso de teste saiu do motor (`js/alerts.js`). Para conferir um aparelho novo, crie uma tarefa para daqui a uns 3 minutos com "me avise na hora".
- Configurações: **Testar a IA** aceita outra frase (para ver como a IA entende "já paguei...", "apaga...", frases longas). O pedido à IA agora é maior (instruções e exemplos de concluir, alterar, excluir e de descrição): cerca de 70 neurons por frase (estimativa: uns 2.000 tokens de entrada), uns 140 frases por dia grátis na conta toda; o modelo de 8 bilhões (`AI_MODEL`) custa cerca de 6 vezes menos.
- Serviço da Cloudflare: a resposta de `/interpretar` ganhou `acao`, `descricao` e `alvo`; o app avisa `comandos: true` (apps antigos recebem sempre "criar"). **Exige colar o `worker/lembretes.js` novo no painel e fazer Deploy.**
- Por dentro: `js/match.js` (achar a tarefa pelo que a pessoa disse), `js/ui/commands.js` (concluir, alterar e excluir por voz), `js/ui/swipe.js` (o gesto), `js/ui/install.js` (o convite de instalar), `interpretAiReply` em `js/ai.js`.
- Testes: 341 -> 381 (novos: `match`, `swipe`, `install`; o microfone que só envia ao mandar, a descrição e os comandos na IA e no Worker, e a conta zerada).

## 1.7.0

- **A IA da fala vem ligada** (pedido do dono): não é mais preciso ligar em cada aparelho. Em **Configurações > Entender a fala com IA** dá para desligar, por aparelho, e quem desliga continua com tudo funcionando pelas regras. No primeiro uso aparece um aviso de que o texto falado vai ao serviço do Pauta (que não o guarda) e de como desligar. Quem já tinha ligado ou desligado antes mantém a escolha.
- **A IA só usa o que você disse**: o pedido à IA agora manda manter as palavras da fala (só tirar hesitações e o pedido, pôr o verbo no infinitivo, sem sinônimos nem "melhorar" o título) e o app confere: se o título que a IA devolveu tem uma palavra que você não falou ("Marcar consulta no dentista" para "marcar dentista"), vale o título tirado da sua fala; o dia, a hora, a prioridade e o resto continuam sendo conferidos como antes. **Exige colar o `worker/lembretes.js` novo no painel da Cloudflare** (só o texto do pedido mudou; feito em 09/11/2026); sem isso a conferência do app já vale, só falta a instrução à IA.
- **Microfone que não trava, principalmente no iPhone**:
  - No iPhone o reconhecimento deixa de usar o modo contínuo do Safari (instável: o fim e o texto podem nunca chegar) e passa a ouvir uma frase por vez, voltando a ouvir sozinho; para quem fala é igual.
  - O recado "Ouvindo…" ganhou o botão **Parar e enviar** (no iPhone não existe a tecla Enter). Depois de parar, o app espera pouco pelo navegador (2 s no iPhone, 3 s nos outros) e termina por ele; tocar de novo em **Enviar agora** termina na hora.
  - Se o navegador der erro e nunca avisar o fim, ou a tela for para segundo plano (iPhone), o microfone é solto. Se a entrega do texto der erro, a tela ainda volta ao normal.
  - Se o microfone liga e nenhuma palavra aparece em 8 segundos, o app avisa e oferece o microfone do teclado.
- **A espera da IA nunca prende a tela**: o prazo de 10 s passa a contar também a renovação do login (antes só o pedido; uma renovação travada deixava "Entendendo com IA…" para sempre), há o botão **Pular a IA** (apertar Enter de novo também pula), e qualquer erro ali segue com as regras do aparelho.
- **Relatório do microfone** (Configurações > Problemas com o microfone?): copia uma linha do tempo do último uso do microfone (horários e nomes dos eventos, nunca o que foi falado), para descobrir o que houve quando algo trava num aparelho que o desenvolvedor não tem.
- Testes: 320 -> 341 (novos: microfone no iPhone, parada forçada, fim garantido, relatório, IA ligada por padrão, prazo do login, pular a IA, título fiel à fala).

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
