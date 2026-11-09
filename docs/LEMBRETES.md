# Lembretes e voz

Duas coisas que andam juntas e que são opcionais:

- **Lembrete** ("despertador"): numa tarefa que tem data e hora, você escolhe ser avisado 5 minutos, 15 minutos, 1 hora ou 1 dia antes.
- **Voz**: o botão do microfone ao lado de **Adicionar** ouve uma frase falada (até você mandar parar), entende o que você quis e cria a tarefa; se algo não ficar claro, abre a janela da tarefa para você completar.

O lembrete funciona **sem instalar nada** enquanto o app está aberto. Para o aviso chegar **com o app fechado** (o que você quer no celular), é preciso instalar uma vez um pequeno serviço gratuito na Cloudflare. O passo a passo está mais abaixo.

## Como usar

### Lembrete

1. Abra a tarefa, escolha **data** e **hora** e, em **Lembrete**, o tempo de antecedência.
2. Ou escreva direto no campo de adicionar: `Reunião sexta 14h, me avise 15 minutos antes`. Também valem `lembrete 1 hora antes`, `me avise meia hora antes`, `me avise 2 dias antes` e `me avise na hora`.
3. Em **Configurações > Avisos dos lembretes**, toque em **Ligar avisos** (o aparelho pergunta se pode mostrar notificações). Isso é feito uma vez em cada aparelho.

Regras: o lembrete só existe em tarefa com data e hora; se você tirar a hora, o lembrete some junto. Ao repetir a tarefa (ou duplicá-la), o lembrete vai junto. Mudar a hora ou a antecedência cria um aviso novo, que toca de novo.

**No iPhone** as notificações só funcionam com o Pauta **instalado na Tela de Início** (Safari: Compartilhar, depois Adicionar à Tela de Início), no iOS 16.4 ou mais novo, e abrindo o app por esse ícone. Numa aba comum do Safari o iPhone não oferece notificações.

### Voz

Toque no microfone e fale a tarefa do seu jeito, **com as pausas que precisar**. O microfone fica ouvindo até você **tocar nele de novo ou apertar Enter** (para sozinho só se passar 45 segundos sem ouvir uma palavra, ou 3 minutos no total). Por exemplo:

> quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas, me avise 15 minutos antes

O app não escreve a frase como foi dita: ele entende o que você quis. Tira o "pedido" e as hesitações, descobre o título (**Pagar boleto**), o dia, a hora e o lembrete, cria a tarefa e mostra o que entendeu, com **Desfazer**. O que ele sabe fazer:

- **Tirar a conversa**: "hum", "então", "né", palavras repetidas, "quero que crie uma tarefa", "anota aí", "tarefa:", "por favor".
- **Reescrever a intenção**: `preciso comprar leite amanhã` vira "Comprar leite"; `tenho reunião com o cliente na quinta às 14h30` vira "Reunião com o cliente".
- **Números e horas por extenso**: `às oito`, `às quatro e vinte`, `às nove e meia da noite`, `dia dez`, `dia primeiro`.
- **Hora relativa**: `daqui a 20 minutos`, `em duas horas`, `dentro de meia hora` viram uma hora marcada.
- **Lembrete, prioridade e etiqueta**: `me avise quinze minutos antes`, `com prioridade alta` ou `é urgente`, `com a etiqueta trabalho`.
- **Correções no meio da frase**: `às 16, quer dizer, às 17` vale o último que você disse (também com "ou melhor", "na verdade" e "não, ..."; vale para data, hora, prioridade e lembrete).

**Quando algo não fica claro, o app não chuta**: abre a janela **Nova tarefa** (a mesma da edição) com tudo o que entendeu já preenchido e o resto em branco, diz o que ficou em dúvida e mostra o que você disse. Você completa e toca em **Adicionar**, ou em **Descartar** (com **Desfazer**). Acontece quando:

- não deu para saber o título (ou ele ficou vago, como "uma tarefa");
- sobrou uma data ou hora que não deu para ler (`dia 32`, `às 25 horas`);
- você pediu lembrete e não disse a hora (o pedido fica guardado: ao escolher a hora, o lembrete liga sozinho);
- você disse só a hora e ela já passou hoje (`às 8 horas` às 9h: era hoje ou amanhã?);
- você se corrigiu no título (`pagar o boleto, quer dizer, pagar a fatura`);
- o navegador avisou que não ouviu com clareza.

Se tudo ficou claro, a tarefa é criada direto. Isso é feito por regras no próprio aparelho, não por inteligência artificial: frases muito soltas ou longas podem fugir do que ele entende, e nesse caso você cai na janela **Nova tarefa** em vez de ficar com uma tarefa errada.

- Funciona no Chrome e no Edge (computador e Android) e no Safari (em aba comum). **Não funciona no Firefox** e, até onde se sabe, **nem no app da Tela de Início do iPhone** (a Apple diz que o reconhecimento de voz do navegador não está disponível nesse modo). Mesmo assim o Pauta **tenta**: se o seu iPhone liberar, o microfone do app funciona; se recusar, o app avisa, passa para o **microfone do teclado** (o ditado do iPhone) e não insiste por 7 dias, a menos que você toque em **Tentar o microfone do app de novo**. Com o microfone do teclado, fale, confira a pré-visualização e toque em **Adicionar**: o app entende a frase falada do mesmo jeito (e abre a janela **Nova tarefa** se algo ficar em dúvida).
- O reconhecimento de voz é do próprio navegador (o Chrome envia o áudio para o Google). O Pauta não grava nem guarda o áudio. A interpretação da frase acontece no aparelho, **a não ser que você ligue a IA** (próxima seção): só nesse caso o texto falado vai ao serviço do Pauta.

### Entender a fala com IA (opcional, desligada por padrão)

As regras do aparelho entendem bem a maior parte das frases, mas frases muito soltas ("ah então, tipo, lembra de ligar pro seu José, o do financeiro, na quinta de manhã, umas nove horas por aí") pedem mais. Para isso há uma IA opcional, como o ditado do Claude ou as legendas do Meet: ela reescreve a frase como uma tarefa bem escrita.

- **Como ligar**: **Configurações > Entender a fala com IA > Usar a IA neste aparelho** (vale só para aquele aparelho, e precisa de conta e de internet). Toque em **Testar a IA** para conferir: mostra como a IA entendeu uma frase de exemplo ou por que não deu.
- **O que sai do aparelho quando está ligada**: a frase falada (**só o texto**), a data de hoje, a hora de agora e o token do seu login (para o serviço saber que é você). Vai ao serviço do Pauta na Cloudflare e dele a uma IA da própria Cloudflare (Workers AI, modelo Llama 3.3 de 70 bilhões de parâmetros). **O serviço não guarda nem registra a frase**: o banco só tem um contador de pedidos por pessoa. Texto **digitado** nunca vai. Desligada, nada do que você fala sai do aparelho.
- **Quando é usada**: ao terminar de falar no microfone do app e também no texto ditado pelo teclado (iPhone) quando você toca em **Adicionar**.
- **Ela não manda sozinha**: a linha que a IA devolve passa pelo mesmo analisador de frases digitadas. O que a IA inventou (um dia ou hora que você não disse) é descartado; o que você disse e ela deixou cair volta; se ela apontar dúvida (por exemplo, não achou a tarefa), abre a janela **Nova tarefa**, como já acontece com as regras.
- **Se falhar** (sem internet, sem login, limite do dia, serviço fora do ar ou demora), o app avisa ("Usei o jeito normal") e entende a frase pelas regras do aparelho. A IA nunca é necessária.
- **Custo**: zero dentro do limite gratuito da Cloudflare (10.000 "neurons" por dia no Workers AI). Uma frase gasta algo perto de 40 neurons (estimativa, ainda não medida: a conta inclui as instruções e os exemplos enviados junto): cerca de 240 frases por dia no plano gratuito. Passou do limite, o plano gratuito não cobra: a IA para de responder até o dia seguinte (21h no horário de Brasília) e o app usa as regras. Cada pessoa tem ainda um limite próprio de 40 pedidos por hora e 150 por dia, para conter abuso.

## Como os avisos funcionam (e o que sai do seu aparelho)

```
com o app aberto     o Pauta confere a cada 20 segundos e mostra o aviso (na tela, ou como notificação se a aba está escondida)
com o app fechado    o serviço de lembretes dá um "toque" (Web Push) no horário; o aparelho acorda o service worker do Pauta,
                     que mostra a notificação lendo os títulos de uma cópia guardada no próprio aparelho
```

- O serviço **só recebe** o endereço de aviso do aparelho e os **horários** dos lembretes. **Títulos, anotações e o resto das tarefas nunca saem do aparelho**: o "toque" chega vazio e quem sabe o que mostrar é o aparelho.
- Cada aviso é mostrado uma vez. Se a notificação do sistema e o aviso na tela coincidirem, a notificação substitui a anterior em vez de empilhar.
- Se o app abrir depois do horário, os avisos dos últimos 30 minutos aparecem na hora (depois disso a tarefa já está atrasada demais para um lembrete).

## Instalar o serviço de lembretes (uma vez, uns 10 minutos)

Você precisa de uma conta gratuita na [Cloudflare](https://dash.cloudflare.com/) (não pede cartão). Tudo abaixo é feito pelo painel, sem instalar nada no computador.

1. **Workers e Pages**, **Create**, **Create Worker**. Dê o nome `pauta-lembretes` e clique em **Deploy** (o texto "Hello World" que aparece é normal).
2. Clique em **Edit code**, apague tudo e cole o conteúdo de [worker/lembretes.js](../worker/lembretes.js). Clique em **Deploy**.
3. **Storage e bancos de dados**, **D1**, **Create database**, nome `pauta-lembretes`. (As tabelas são criadas sozinhas no primeiro uso.)
4. Volte ao Worker: **Settings**, **Bindings**, **Add binding**, **D1 database**. Em *Variable name* escreva exatamente `DB` e escolha o banco `pauta-lembretes`.
5. Ainda em **Settings**, **Trigger events**, **Cron triggers**, **Add**, aba **Cron expression**: `* * * * *` (todo minuto). Salve.
6. Se o seu site **não** for `https://mekea-dev.github.io`, em **Settings**, **Variables**, crie `ALLOWED_ORIGINS` com o endereço do seu site (vários separados por vírgula, sem barra no fim). Opcional: `VAPID_SUBJECT` com o endereço de uma página sua (padrão: o do site).
7. Teste: abra `https://pauta-lembretes.SEU-USUARIO.workers.dev/vapid` no navegador. Deve aparecer `{"publicKey":"..."}`. (Ao abrir, o serviço cria as chaves de assinatura dele; a chave privada fica só no banco dele.)
8. No Pauta, coloque o endereço do Worker em `js/push-config.js` (`workerUrl`) **e** no `connect-src` da política de segurança do `index.html` (um teste confere que os dois batem). Publique.
9. Em cada aparelho: **Configurações > Avisos dos lembretes > Ligar avisos**. Depois use **Testar com o app fechado** (chega um aviso em cerca de 1 minuto).

Para desinstalar: apague o Worker e o banco D1 no painel da Cloudflare e deixe `workerUrl` vazio.

### Ligar a IA no serviço (opcional, uns 3 minutos)

Só é preciso se você quer a IA de entender a fala (seção Voz). O código do passo 2 acima já traz a IA; falta dar a ela o recurso da Cloudflare:

1. No Worker: **Settings**, **Bindings**, **Add binding**, **Workers AI**. Em *Variable name* escreva exatamente `AI` e confirme. (Mudar bindings cria uma nova implantação sozinha.)
2. Teste: abra `https://pauta-lembretes.SEU-USUARIO.workers.dev/health`. Deve aparecer `"ia":true`.
3. Opcional, em **Settings**, **Variables**: `AI_MODEL` troca o modelo (lista em <https://developers.cloudflare.com/workers-ai/models/>; o padrão é `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; `@cf/meta/llama-3.1-8b-instruct-fp8-fast` é cerca de 6 vezes mais barato, com menos qualidade). `FIREBASE_PROJECT_ID` só se o seu Firebase não for o `pauta-familia`.
4. No Pauta, em cada aparelho: **Configurações > Entender a fala com IA**, ligue e toque em **Testar a IA**.

O serviço confere o token do login do Firebase com as chaves públicas do Google, então só quem está logado no Pauta consegue usar a IA. Para ver recusas da IA: **Observability**, **Logs**, procure `ia recusou` (o log traz só o motivo, nunca a frase).

## Limites e cuidados

- O horário do aviso tem a precisão de **1 minuto** (é o intervalo do relógio do serviço): o aviso de 15:45 chega entre 15:45 e 15:46.
- O plano gratuito da Cloudflare comporta de sobra uso pessoal ou de família: o relógio de 1 minuto usa 1.440 execuções por dia (o limite é 100 mil). O serviço avisa até 40 aparelhos por minuto e guarda até 100 lembretes por aparelho, de até 60 dias à frente.
- Se você concluir ou apagar uma tarefa em **outro** aparelho, este aparelho só fica sabendo quando o app abrir e sincronizar; até lá, com o app fechado, o aviso pode tocar mesmo assim.
- Os modos "Não perturbe" e "Foco" do celular silenciam as notificações, como em qualquer app.
- Os avisos não exigem login: qualquer pessoa que descubra o endereço consegue cadastrar um endereço de aviso no serviço. Cada aparelho tem uma "senha" própria (que só ele e o serviço de aviso conhecem) e só ela permite mudar ou apagar a lista daquele aparelho; o pior que um estranho consegue é ocupar espaço. O serviço só aceita endereços de aviso do Google, da Apple, do Mozilla e da Microsoft. Já a IA **exige o login do Pauta** (token do Firebase conferido no serviço) e tem limite por pessoa. Como o cadastro no Pauta é aberto, alguém que crie várias contas poderia gastar o limite diário gratuito da IA: o efeito é só a IA parar até o dia seguinte (o app volta às regras), sem cobrança.
- Não testado em todos os aparelhos: o fluxo foi conferido com testes automáticos e simulações. Use o botão **Testar com o app fechado** em cada aparelho para ter certeza.

## Problemas comuns

- **"Ligar avisos" não faz nada ou a permissão aparece como bloqueada**: libere as notificações do Pauta nas configurações do aparelho (iPhone: Ajustes, Notificações, Pauta) e volte em Configurações para ligar de novo.
- **Ligou, mas diz "só com o app aberto"**: o serviço não respondeu. Confira o endereço em `js/push-config.js`, o `ALLOWED_ORIGINS` do Worker e se o passo 7 mostra a chave.
- **O aviso com o app fechado não chega, mesmo ligado**: no painel da Cloudflare, abra o Worker, **Observability**, **Logs**, e procure por `push recusado`. A linha diz qual serviço (Apple, Google...) recusou e com que código (por exemplo, 400, 401 ou 403 indicam que o serviço não aceitou a assinatura; 429 e 5xx são falhas passageiras). Cada aviso é tentado até 6 vezes.
- **Chega um aviso "Você tem um lembrete"** em vez do título: a lista guardada no aparelho estava desatualizada (por exemplo, o aparelho ficou dias sem abrir o app). Abra o Pauta para atualizar.
- **No iPhone, o botão do microfone avisa que não está disponível e leva ao campo de texto**: é o esperado no app da Tela de Início (veja Voz, acima). Use o microfone do teclado. Para o app tentar de novo, toque em "Tentar o microfone do app de novo".
- **"Testar a IA" diz "Entre na sua conta"**: a IA precisa do login. Entre de novo (a sessão pode ter vencido).
- **"Testar a IA" diz "indisponível"**: o limite gratuito do dia da Cloudflare acabou, ou o recurso Workers AI não está ligado no serviço (confira `"ia":true` em `/health`) ou a Cloudflare está com problema. O app continua funcionando com as regras.
- **"Testar a IA" diz "usou a IA demais"**: passou de 40 pedidos na hora ou 150 no dia; espere um pouco.
- **A IA "não faz nada" ao falar**: ela só atua no texto que veio da fala (microfone ou ditado do teclado). Texto digitado vai direto para as regras.
