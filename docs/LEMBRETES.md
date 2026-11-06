# Lembretes e voz

Duas coisas que andam juntas e que são opcionais:

- **Lembrete** ("despertador"): numa tarefa que tem data e hora, você escolhe ser avisado 5 minutos, 15 minutos, 1 hora ou 1 dia antes.
- **Voz**: o botão do microfone ao lado de **Adicionar** entende uma frase falada e cria a tarefa.

O lembrete funciona **sem instalar nada** enquanto o app está aberto. Para o aviso chegar **com o app fechado** (o que você quer no celular), é preciso instalar uma vez um pequeno serviço gratuito na Cloudflare. O passo a passo está mais abaixo.

## Como usar

### Lembrete

1. Abra a tarefa, escolha **data** e **hora** e, em **Lembrete**, o tempo de antecedência.
2. Ou escreva direto no campo de adicionar: `Reunião sexta 14h, me avise 15 minutos antes`. Também valem `lembrete 1 hora antes`, `me avise meia hora antes`, `me avise 2 dias antes` e `me avise na hora`.
3. Em **Configurações > Avisos dos lembretes**, toque em **Ligar avisos** (o aparelho pergunta se pode mostrar notificações). Isso é feito uma vez em cada aparelho.

Regras: o lembrete só existe em tarefa com data e hora; se você tirar a hora, o lembrete some junto. Ao repetir a tarefa (ou duplicá-la), o lembrete vai junto. Mudar a hora ou a antecedência cria um aviso novo, que toca de novo.

**No iPhone** as notificações só funcionam com o Pauta **instalado na Tela de Início** (Safari: Compartilhar, depois Adicionar à Tela de Início), no iOS 16.4 ou mais novo, e abrindo o app por esse ícone. Numa aba comum do Safari o iPhone não oferece notificações.

### Voz

Toque no microfone e fale a tarefa do seu jeito, por exemplo:

> quero que crie uma tarefa com título pagar boleto com prazo para dia 10 às 16 horas, me avise 15 minutos antes

O app tira o "pedido", entende o título (**Pagar boleto**), o dia, a hora e o lembrete, cria a tarefa e mostra o que entendeu, com **Desfazer**. Também entende `reunião sexta às quatro e meia da tarde com prioridade alta` ou `lembre-me de ligar para o João amanhã às nove`.

- Funciona no Chrome e no Edge (computador e Android) e no Safari (em aba comum). **Não funciona no Firefox** e, até onde se sabe, **nem no app da Tela de Início do iPhone** (a Apple diz que o reconhecimento de voz do navegador não está disponível nesse modo). Mesmo assim o Pauta **tenta**: se o seu iPhone liberar, o microfone do app funciona; se recusar, o app avisa, passa para o **microfone do teclado** (o ditado do iPhone) e não insiste por 7 dias, a menos que você toque em **Tentar o microfone do app de novo**. Com o microfone do teclado, fale, confira a pré-visualização e toque em **Adicionar**: o app entende a frase falada do mesmo jeito.
- Se o app não entender o título, ele deixa o texto no campo para você completar.
- O reconhecimento de voz é do próprio navegador (o Chrome envia o áudio para o Google). O Pauta não grava nem guarda o áudio.

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

## Limites e cuidados

- O horário do aviso tem a precisão de **1 minuto** (é o intervalo do relógio do serviço): o aviso de 15:45 chega entre 15:45 e 15:46.
- O plano gratuito da Cloudflare comporta de sobra uso pessoal ou de família: o relógio de 1 minuto usa 1.440 execuções por dia (o limite é 100 mil). O serviço avisa até 40 aparelhos por minuto e guarda até 100 lembretes por aparelho, de até 60 dias à frente.
- Se você concluir ou apagar uma tarefa em **outro** aparelho, este aparelho só fica sabendo quando o app abrir e sincronizar; até lá, com o app fechado, o aviso pode tocar mesmo assim.
- Os modos "Não perturbe" e "Foco" do celular silenciam as notificações, como em qualquer app.
- O serviço não tem login: qualquer pessoa que descubra o endereço consegue cadastrar um endereço de aviso nele. Cada aparelho tem uma "senha" própria (que só ele e o serviço de aviso conhecem) e só ela permite mudar ou apagar a lista daquele aparelho; o pior que um estranho consegue é ocupar espaço. O serviço só aceita endereços de aviso do Google, da Apple, do Mozilla e da Microsoft.
- Não testado em todos os aparelhos: o fluxo foi conferido com testes automáticos e simulações. Use o botão **Testar com o app fechado** em cada aparelho para ter certeza.

## Problemas comuns

- **"Ligar avisos" não faz nada ou a permissão aparece como bloqueada**: libere as notificações do Pauta nas configurações do aparelho (iPhone: Ajustes, Notificações, Pauta) e volte em Configurações para ligar de novo.
- **Ligou, mas diz "só com o app aberto"**: o serviço não respondeu. Confira o endereço em `js/push-config.js`, o `ALLOWED_ORIGINS` do Worker e se o passo 7 mostra a chave.
- **O aviso com o app fechado não chega, mesmo ligado**: no painel da Cloudflare, abra o Worker, **Observability**, **Logs**, e procure por `push recusado`. A linha diz qual serviço (Apple, Google...) recusou e com que código (por exemplo, 400, 401 ou 403 indicam que o serviço não aceitou a assinatura; 429 e 5xx são falhas passageiras). Cada aviso é tentado até 6 vezes.
- **Chega um aviso "Você tem um lembrete"** em vez do título: a lista guardada no aparelho estava desatualizada (por exemplo, o aparelho ficou dias sem abrir o app). Abra o Pauta para atualizar.
- **No iPhone, o botão do microfone avisa que não está disponível e leva ao campo de texto**: é o esperado no app da Tela de Início (veja Voz, acima). Use o microfone do teclado. Para o app tentar de novo, toque em "Tentar o microfone do app de novo".
