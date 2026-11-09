# Guia para continuar o desenvolvimento

Este guia existe para você (ou um assistente, como o Claude Code) retomar o Pauta em outro computador **sem depender da conversa em que ele foi feito**. Ele diz onde as coisas estão, como rodar e testar, o que já foi feito e verificado, o que falta, o que foi decidido e por quê, e as armadilhas que já apareceram.

Última atualização: 09/11/2026, versão **1.7.0**. O histórico de versões está em [CHANGELOG.md](../CHANGELOG.md). As instruções curtas para o Claude Code estão em [CLAUDE.md](../CLAUDE.md).

## Primeiros passos em outro computador

1. `git clone https://github.com/mekea-dev/pauta.git` e entre na pasta.
2. Suba um servidor local (módulos JavaScript e service worker não funcionam abrindo o arquivo com duplo clique):
   - Windows, sem instalar nada: `powershell -NoProfile -ExecutionPolicy Bypass -File .\servir.ps1` (abre em `http://localhost:8789/`).
   - Qualquer sistema com Python: `python -m http.server 8789`.
3. Abra `http://localhost:8789/tests/`. Deve aparecer **OK** com todos os testes (341 em 09/11/2026). Com Node 18 ou mais novo: `node --test` (o GitHub Actions usa o Node 22).
4. Para testar login e sincronização **sem tocar no Firebase real**: `python scripts/emulador-nuvem.py --porta 8790` e abra `http://localhost:8790/`. O código de convite do emulador é `FAMILIA2026`. As contas ficam só na memória dele e somem quando ele é reiniciado.
5. Com o Claude Code: abra a pasta do repositório (ele lê o `CLAUDE.md` sozinho) e peça para ler este guia primeiro.

Não há build, não há `npm install`, não há dependências: JavaScript puro em módulos (`import`), CSS puro, tudo servido como está pelo GitHub Pages.

## Onde está cada coisa

Endereços: site em <https://mekea-dev.github.io/pauta/> (GitHub Pages, ramo `main`, raiz), código em <https://github.com/mekea-dev/pauta> (público, licença MIT).

### Arquivos

| Caminho | O que faz |
|---|---|
| `index.html` | página única; a política de segurança (CSP) fica aqui e lista os endereços que o app pode chamar |
| `css/app.css` | todos os estilos; tema claro e escuro por variáveis no começo |
| `sw.js` | service worker: modo offline (rede primeiro), notificações dos lembretes (`push`, `notificationclick`) e leitura do espelho de avisos |
| `manifest.webmanifest` | instalação como app (PWA) |
| `worker/lembretes.js` | **serviço de lembretes e da IA da fala** (Cloudflare Worker). Não faz parte do site: é colado no painel da Cloudflare |
| `js/ai.js` | IA da fala (**ligada por padrão**, desligável por aparelho): `createAi` (pedido ao serviço com o token do login, motivos de falha, prazo de 10 s que conta o login, `signal` para pular, aviso do primeiro uso), `isLiteral` (o título só pode ter palavras ditas) e `reconcile` (junta a linha da IA com o que as regras entenderam) |
| `js/config.js` | nome, **versão** (`APP_VERSION`) e chaves de armazenamento |
| `js/dates.js` | datas como texto `AAAA-MM-DD` (sem fuso), nomes e formatos em português; `minuteChoices` (minutos de 5 em 5 da escolha da hora) |
| `js/text.js` | `fold` (minúsculas, sem acento, mesmo tamanho) e ajudantes de plural |
| `js/recurrence.js` | regras de repetição (todo dia, dias úteis, a cada N semanas...) |
| `js/parser.js` | adicionar rápido em português: data, hora, prioridade, etiquetas, repetição e **lembrete** ("me avise 15 minutos antes") |
| `js/voice.js` | a fala vira tarefa, **tudo no aparelho, por regras**: `normalizeSpoken` (tira hesitações, o "pedido" e a intenção; números, horas e hora relativa por extenso viram dígitos; correções) e `interpretSpoken` (usa a de cima + o parser e devolve a tarefa, a lista de dúvidas `issues` e `clear`) |
| `js/model.js` | tarefa, etiqueta, estado; `createTask`, `sanitizeTask`, `cleanRemind`, `mergePatch` (a regra de edição, usada pela tarefa e pelo rascunho) |
| `js/store.js` | estado em memória, desfazer, operações (`addTask`, `updateTask`, `toggleDone`...) |
| `js/persist.js` | localStorage (`pauta:v1`) com reserva em memória e cópia do que estiver corrompido |
| `js/query.js` | filtros, ordenação, contagens e busca |
| `js/io.js` | backup JSON, planilha CSV (a coluna Lembrete é a última), importar e mesclar |
| `js/reminders.js` | contas dos lembretes: quando avisar, o que já está na hora, texto do aviso |
| `js/alerts.js` | **motor dos lembretes**: relógio de 20 s, espelho de avisos (Cache API), envio da lista ao serviço, ligar, desligar e testar |
| `js/push.js` | inscrição Web Push e conversa com o serviço de lembretes |
| `js/push-config.js` | endereço do serviço (`workerUrl`) |
| `js/speech.js` | microfone (Web Speech): ouve em várias rodadas até mandarem parar, junta o texto, bloqueio lembrado, limites de tempo e **fim garantido** (parada forçada, `onEnd` sempre, iPhone sem modo contínuo, solta o microfone ao ir para segundo plano); `report()` e `formatSpeechReport` (linha do tempo do último uso, sem o texto falado) |
| `js/main.js` | ponto de entrada: dados, rotas, ligação das peças, service worker |
| `js/sync/merge.js` | mescla das tarefas entre aparelhos (a mais recente vence; lápides de 90 dias) |
| `js/cloud/` | login e banco do Firebase por REST (`firebase.js`), motor de sincronização (`sync.js`), regras de conta (`account.js`) e a configuração (`config.js`) |
| `js/ui/` | a tela: `composer` (campo de adicionar e microfone), `editor` (editar tarefa **e** rascunho de tarefa nova, `openDraft`), `timepick` (hora e minutos de 5 em 5), `taskrow`, `views`, `calendar`, `sidebar`, `topbar`, `settings`, `account`, `actions`, `overlay`, `notify`, `icons`, `shortcuts`, `dom` |
| `scripts/emulador-nuvem.py` | "Firebase de mentira" local (login, banco e as mesmas regras do guia) |
| `scripts/gerar-icones.ps1` | recria os PNGs dos ícones |
| `tests/` | testes (Node e navegador); `tests/shim/` faz o `node:test` funcionar no navegador |
| `docs/` | guias (`NUVEM.md`, `LEMBRETES.md`, este), regras do banco (`regras-banco*.json`) e imagens do README |

### Testes (341 em 09/11/2026)

`dates`, `recurrence`, `parser`, `voice` (frases faladas: limpeza, correções, o que fica claro e o que vira dúvida), `reminders` (contas), `speech` (microfone, com um reconhecedor de mentira que o teste "faz falar"), `push` (inscrição), `alerts` (motor), `sw` (o `sw.js` roda dentro de um navegador de mentira: `push` e `notificationclick`), `worker` (o serviço, inclusive a assinatura VAPID), `model`, `query`, `store`, `merge`, `cloud` (Firebase de mentira), `io` e `site` (consistência do pacote do site).

### Regras do projeto que os testes cobram

- **Versão em dois lugares**: `APP_VERSION` em `js/config.js` e `VERSION` em `sw.js` precisam ser iguais.
- **Arquivo novo em `js/`, `css/` ou `icons/`** entra na lista `ASSETS` do `sw.js` (senão o modo offline não o guarda).
- **Sem emojis nem símbolos pictográficos** (setas, marcas, bolinhas) em JS, CSS, `index.html`, `README.md`, `CHANGELOG.md`, `CLAUDE.md` e nos guias em `docs/`. Ícones só pelos SVG do Lucide em `js/ui/icons.js` (licença em `THIRD-PARTY-LICENSES.md`).
- **Sem `innerHTML`, `insertAdjacentHTML` ou `document.write`** fora de `js/ui/icons.js`. Texto da pessoa entra sempre como texto.
- **Caminhos relativos**: o site roda em `usuario.github.io/pauta/`, não na raiz.
- **Política de segurança** (`index.html`): sem script ou estilo embutido; `connect-src` precisa listar o endereço de `js/push-config.js` (há um teste).
- **Regras do banco**: os blocos JSON de `docs/NUVEM.md` precisam ser iguais a `docs/regras-banco*.json`.
- **Espelho de avisos**: o nome do cache (`avisos-v1`) é igual em `sw.js` e `js/alerts.js` e **não pode começar com `pauta-`** (o `activate` do `sw.js` apaga os caches antigos com esse prefixo).
- **`worker/lembretes.js`** é um arquivo só, sem dependências, válido como módulo de Worker (`export default { fetch, scheduled }`) e também importável nos testes.

## Como publicar

1. Rode os testes (navegador em `/tests/` ou `node --test`).
2. Suba a versão se o app mudou (dois lugares, veja acima).
3. `git add -A`, commit e `git push origin main`. O GitHub Actions roda os testes (`.github/workflows/ci.yml`, Node 22) e o GitHub Pages publica sozinho em cerca de um minuto (<https://github.com/mekea-dev/pauta/actions>).
4. Se a publicação falhar com "Deployment failed, try again later" (já aconteceu uma vez, erro passageiro): Actions, "pages build and deployment", **Re-run failed jobs**.
5. Conferir no ar: o rodapé de Configurações mostra a versão; `https://mekea-dev.github.io/pauta/sw.js` mostra `VERSION`.

No outro computador, o primeiro `git push` pede o login do GitHub (conta `mekea-dev`); depois o Git guarda a credencial. Identidade dos commits: `Leonardo Maquea <333067854+mekea-dev@users.noreply.github.com>` (o e-mail "noreply" do GitHub). **Não use e-mail pessoal ou do trabalho** nos commits: o repositório é público. No PowerShell 5.1 (Windows), `git commit -m "texto com aspas"` quebra; grave a mensagem num arquivo e use `git commit -F arquivo`.

O app instalado no celular atualiza sozinho (o service worker busca a rede primeiro), mas o iPhone costuma precisar de **fechar e abrir o app de novo uma vez** para pegar a versão nova.

## Configurações que moram fora do repositório

Estas coisas foram feitas nos painéis e **não** estão no código. Se precisar refazer do zero:

### GitHub

Repositório público; Settings, Pages: **Deploy from a branch**, `main`, `/(root)`.

### Firebase (login e sincronização)

Projeto `pauta-familia`, plano gratuito (Spark): Authentication com **e-mail/senha**; Realtime Database em `us-central1` (`https://pauta-familia-default-rtdb.firebaseio.com`); app web registrado; regras de `docs/regras-banco-aberto.json` publicadas. A `apiKey` e o `databaseUrl` ficam em `js/cloud/config.js` (a chave de API do Firebase para web **não é segredo**: qualquer visitante do site a recebe). O guia completo está em [NUVEM.md](NUVEM.md).

Estado das opções em `js/cloud/config.js`: `exigirLogin: true` (o app só abre para quem entrou; é regra de tela, a proteção real são o login e as regras do banco) e `exigirConvite: false` (cadastro aberto: quem tiver o endereço cria a conta). As regras e `exigirConvite` **precisam combinar**. O nó `convite` ficou no banco sem uso (pode apagar).

### Cloudflare (serviço de lembretes)

Conta gratuita do dono do repositório (entre em <https://dash.cloudflare.com/> com a mesma conta que criou o Worker). O que existe lá:

| Item | Valor |
|---|---|
| Worker | `pauta-lembretes`, em `https://pauta-lembretes.leonardomaquea96.workers.dev` |
| Código | o conteúdo de `worker/lembretes.js` (colado no editor do painel; **o código no ar precisa ser o do repositório**) |
| Banco D1 | `pauta-lembretes` (as tabelas são criadas sozinhas no primeiro uso) |
| Binding | `DB` (D1) apontando para o banco acima |
| Cron | `* * * * *` (todo minuto) |
| Variável | `ALLOWED_ORIGINS` = `https://mekea-dev.github.io` (vários separados por vírgula) |
| Opcional | `VAPID_SUBJECT` (padrão: `https://mekea-dev.github.io/pauta/`) |
| Chaves VAPID | geradas no primeiro `GET /vapid` e guardadas na tabela `config` do D1. **A chave privada nunca sai de lá**; se o banco for apagado, as chaves mudam e cada aparelho precisa ligar os avisos de novo |

Passo a passo para criar do zero: [LEMBRETES.md](LEMBRETES.md). Para **atualizar o código** do Worker: abra `worker/lembretes.js` (por exemplo em `http://localhost:8789/worker/lembretes.js`), copie tudo, cole no editor em Workers e Pages, `pauta-lembretes`, **Edit code**, e clique em **Deploy**. O editor mostra avisos de TypeScript em arquivos JavaScript; por isso o código tem conversões em JSDoc (`@type {CryptoKeyPair}`, `@returns {Promise<...>}`): mantenha.

Alternativa, **não testada**: usar o `wrangler` (`npm i -g wrangler`, `wrangler login`) com um `wrangler.jsonc` assim (troque o `database_id` pelo do painel; cuidado: um `wrangler deploy` pode sobrescrever bindings, variáveis e cron feitos pelo painel):

```jsonc
{
  "name": "pauta-lembretes",
  "main": "lembretes.js",
  "compatibility_date": "2025-01-01",
  "d1_databases": [{ "binding": "DB", "database_name": "pauta-lembretes", "database_id": "ID-DO-BANCO" }],
  "triggers": { "crons": ["* * * * *"] },
  "vars": { "ALLOWED_ORIGINS": "https://mekea-dev.github.io" }
}
```

Para olhar o banco: D1, `pauta-lembretes`, aba **Console** (por exemplo `SELECT COUNT(*) FROM subs`). Não consulte a linha `vapid` da tabela `config`: é a chave privada. Para ver recusas de entrega: Worker, **Observability**, **Logs**, procure `push recusado`.

Limites do plano gratuito que moldaram o código: 10 ms de CPU e 50 chamadas externas (as do D1 contam) por execução, 100 mil requisições por dia, 5 gatilhos de cron por conta. Por isso o serviço avisa no máximo 40 aparelhos por minuto e agrupa as escritas no banco.

## Os lembretes por dentro

**Dados.** Cada tarefa tem `remind`: minutos antes da hora (0 = na hora, no máximo 10080 = 7 dias) ou `null`. Só vale com data **e** hora (`cleanRemind` zera sem hora). Repetir e duplicar levam o `remind` junto. O id de um aviso é `idDaTarefa|instanteISO`: mudar a hora ou a antecedência cria um aviso novo, que pode tocar de novo.

**Com o app aberto** (`js/alerts.js`): um relógio de 20 s procura avisos que já estão na hora (`due()` em `js/reminders.js`: o horário do aviso passou e a tarefa não venceu há mais de 30 min). Aba visível: aviso na tela (toast "Lembrete: ..."); aba escondida: notificação do sistema (`registration.showNotification`). O que já foi mostrado fica anotado em `mostrados` para nunca repetir.

**Com o app fechado**: o app mantém uma cópia dos próximos avisos (o **espelho**, com título e texto prontos) no cache `avisos-v1` (Cache API), que a página e o `sw.js` leem. Ao mesmo tempo manda ao serviço **só `{id, at}`** de cada aviso (`PUT /reminders`). Todo minuto o serviço dá um "toque" (Web Push **sem conteúdo**, assinado com VAPID) nos aparelhos com aviso vencido; o `sw.js` acorda, lê o espelho e mostra a notificação. Os títulos **nunca** passam pelo serviço.

**Regras do iPhone/Safari que o código respeita**:
- Notificações só no app instalado na Tela de Início, iOS 16.4 ou mais novo, com a permissão pedida a partir de um toque (por isso "Ligar avisos" é um botão e o `enable()` chama `requestPermission()` direto do clique).
- **Todo toque precisa virar uma notificação**, senão o sistema cancela a inscrição. Por isso, quando não há aviso novo, o `sw.js` mostra de novo o último (mesmo `tag`: a notificação é trocada, não duplicada) e, sem nenhum, mostra "Você tem um lembrete".
- O app da Tela de Início tem armazenamento separado do Safari (login e dados não são compartilhados entre os dois).

**Protocolo do serviço** (`worker/lembretes.js`; CORS só para `ALLOWED_ORIGINS`):

| Chamada | Corpo | Resposta |
|---|---|---|
| `POST /interpretar` | `Authorization: Bearer <token do Firebase>`; `{ fala, hoje, agora }` | `{ texto, duvidas }`; 401 login, 429 limite, 503 IA indisponível, 502 resposta inválida (veja "IA opcional") |
| `GET /vapid` | - | `{ publicKey }` (base64 de URL, 65 bytes) |
| `POST /subscribe` | `{ endpoint, auth }` (ou `keys.auth`) | `{ ok }`; 400 se o endereço não for do Google, Apple, Mozilla ou Microsoft; 403 se o endereço já existe com outra senha |
| `PUT /reminders` | `{ endpoint, auth, reminders: [{ id, at }] }` | troca a lista do aparelho; aceita `at` de 1 h atrás até 60 dias à frente, até 100 avisos; 403 com senha errada |
| `DELETE /subscription` | `{ endpoint, auth }` | apaga o aparelho |
| `GET /` ou `/health` | - | `{ ok: true, ..., ia }` (`ia`: o recurso Workers AI está ligado) |

O `auth` é a chave da inscrição push (só o aparelho e o serviço de aviso a conhecem); o serviço guarda só o hash dela. A cada minuto (`scheduled`): pega até 40 aparelhos com aviso vencido, envia o toque (`Authorization: vapid t=..., k=...`, `TTL: 3600`, `Urgency: high`); 2xx apaga os avisos vencidos; 404 ou 410 apaga o aparelho; outro código soma uma tentativa (6 no máximo) e registra `push recusado` no log. Uma vez por hora (minuto 0) apaga avisos com mais de 2 dias ou sem tentativas restantes e aparelhos sem avisos há mais de 90 dias.

**Testar o aviso de ponta a ponta no computador** (o que **ainda não foi feito**, porque exige que uma pessoa clique em "Permitir" no pedido do navegador):
1. No painel da Cloudflare, acrescente `http://localhost:8790` a `ALLOWED_ORIGINS` (e **remova depois**).
2. Suba o emulador (`python scripts/emulador-nuvem.py --porta 8790`), crie uma conta de teste nele e abra `http://localhost:8790/` no Chrome.
3. Configurações, Avisos dos lembretes, **Ligar avisos**; clique em Permitir; depois **Testar com o app fechado**.
4. Em até 2 minutos deve aparecer a notificação do Chrome. Se não aparecer: D1 Console (`SELECT COUNT(*) FROM subs`, `SELECT COUNT(*) FROM reminders`) e os Logs do Worker.

## A voz por dentro

### Ouvir (`js/speech.js`)

Usa a Web Speech API do navegador (`SpeechRecognition` ou `webkitSpeechRecognition`), em `pt-BR`, com `continuous = true` e resultados provisórios. O navegador costuma encerrar a rodada sozinho no primeiro silêncio, e uma tarefa falada tem pausas; por isso, **quando a rodada acaba sem ninguém ter mandado parar, o app começa outra (250 ms depois) e junta o texto** (`firm` = o que ficou firme nas rodadas anteriores, `heard` = a rodada de agora). A pessoa termina tocando no microfone de novo ou apertando Enter (`speech.stop()`: o navegador entrega o que faltava e o app chama `onFinal(texto, { confidence })` uma vez).

Limites: 3 minutos no total, 45 s sem nenhuma palavra (`idleMs`), 3 s de espera depois do `stop()` (se o navegador não terminar, o app termina por ele). Proteções: `no-speech` numa pausa não é erro; 4 rodadas seguidas que acabam em menos de 1 s sem ouvir nada (`quickEndMs`) viram erro (sem sinal de vida = `service-not-allowed`), para não ficar num laço; se o `start()` da rodada seguinte falhar 3 vezes, vira erro `unknown`. Alguns navegadores (Chrome no Android) repetem tudo a cada trecho ("oi", "oi tudo", "oi tudo bem"): `absorb()` fica só com o mais completo. `confidence` é a média do que o navegador informou; **0 ou ausente quer dizer "não informa"** (alguns navegadores mandam 0; **o que o iPhone manda não foi conferido**) e vira `null`. Se o editor abrir com "Não ouvi com clareza" em frases que estavam boas, ajuste `LOW_CONFIDENCE` em `js/voice.js`.

### Entender (`js/voice.js`)

Duas camadas, **ambas por regras no aparelho (nenhum texto sai)**:

1. `normalizeSpoken(texto, { now })` devolve um texto que o `parser.js` já sabe ler. Em ordem: tira hesitações ("hum", "ahn", "éééé") e palavras repetidas; conversa antes do pedido ("então", "ah tá") quando o pedido vem logo depois; o **pedido** ("quero que crie uma tarefa com título", "anota aí", "nova tarefa", "tarefa:", "uma tarefa de estudar..."); a **intenção** ("preciso comprar" vira "comprar", "tenho que ligar", "vou levar", "lembrar de pagar", "para eu ir"); o sujeito de "tenho reunião" / "vou ter dentista"; "com prazo para"; hora relativa ("daqui a 20 minutos" vira "hoje às 09:20", só com `now`); números por extenso ("dia dez", "às oito", "às quatro e vinte", "dia primeiro", "me avise quinze minutos antes"); prioridade ("com prioridade alta", "é urgente", "urgente" no fim); etiqueta ("com a etiqueta trabalho"); **correções** ("às 16, quer dizer, às 17": vale a última; só para data, hora, prioridade e lembrete, usando o próprio parser para achar o que foi substituído).
2. `interpretSpoken(texto, { today, now, weekStart, ignore, confidence, defaultDate })` usa a de cima e o parser e devolve o resultado do parser mais `issues` (`[{ code, text }]`), `clear` (`issues` vazio), `heard` e `effectiveDate` (o dia contando o dia aberto na tela e "hora sem dia vale hoje"). Códigos de dúvida: `no-title`, `vague-title` ("uma tarefa", "algo"; **título curto como "X" não é dúvida**), `bad-date` e `bad-time` (sobrou "dia 32" ou "às 25 horas" no título), `bad-remind` (sobrou "me avise ... antes" que não deu para ler), `correction` (correção do título, que não é adivinhada), `time-passed` (hora sem dia e a hora de hoje já passou), `remind-needs-time` (lembrete pedido sem hora) e `low-confidence` (confiança entre 0 e 0,45: `LOW_CONFIDENCE`).

**Cuidado central**: não comer títulos legítimos. "Criar relatório mensal", "Agendar dentista", "Tarefa de casa", "Salão de beleza", "Deixar tudo pronto", "Preciso de ajuda com o relatório" ficam como estão (há testes para isso); só se tira o pedido quando ele é inequívoco. Ao mexer nas regras, rode também a lista de títulos comuns em `tests/voice.test.js`.

### IA da fala (`js/ai.js`, `js/ui/composer.js` e a rota `POST /interpretar` do Worker)

**Aprovada pelo dono em 09/11/2026** porque o **texto falado sai do aparelho** (hoje só horários saem, e só para o serviço de lembretes). Na 1.6.0 vinha **desligada**; na 1.7.0 o dono pediu que viesse **ligada por padrão** ("sem ter que ativar e/ou desativar"). Escolha **por aparelho** (`pauta:ia` no localStorage: `'on'`, `'off'` ou vazio = ligada), em Configurações, "Entender a fala com IA" (com o botão **Testar a IA**). Quem nunca escolheu vê **uma vez por aparelho** um aviso (toast, `pauta:ia-aviso` = `'1'`; `needsNotice`/`noticed`) no primeiro uso: o texto falado vai ao serviço do Pauta, que não o guarda, e como desligar. Quem já tinha ligado ou desligado (`'on'`/`'off'`) mantém a escolha e não vê o aviso. A escolha de desligar vale na hora mesmo que o aparelho não deixe guardar (`choice` em memória).

**Fluxo no app** (`composer.submit`): se o texto do campo veio da fala (`spoken`: microfone ou ditado do teclado) e a IA está disponível (`app.ai.available()`: ligada, com `workerUrl` https, conta logada e internet), `understandWithAi` manda a frase a `app.ai.rewrite` (**10 s no máximo, contando a renovação do login**, que antes ficava de fora e podia prender a tela), mostra "Entendendo com IA..." com o botão **Pular a IA** (apertar Enter de novo também pula; os dois acionam o `AbortController` do pedido, motivo `skipped`) e põe no campo a linha reconciliada; depois o caminho é o de sempre (`finishSubmit`: cria direto se `clear`, ou abre o rascunho). **Nada ali pode prender a tela**: `understandWithAi` e `submit` têm `try/catch/finally` e qualquer erro segue com as regras. Texto **digitado** nunca passa pela IA. Se a pessoa mexer no campo, apertar Esc ou falar de novo enquanto espera, o pedido é abandonado e a resposta descartada (`waiting`, `forgetAi`, que também aborta). Falha (`describeAiFailure`: `login`, `offline`, `limit`, `unavailable`, `timeout`, `error`; `skipped` não gera aviso) vira um aviso e vale `interpretSpoken` do jeito de sempre. `aiExtra` guarda o que foi dito de verdade (aparece no rascunho como "Você disse") e as dúvidas da IA (que não repetem "não entendi o título" quando as regras já disseram).

**A IA é só um "reescritor"**: pede-se a ela UMA linha na sintaxe do adicionar rápido ("Pagar o boleto dia 10 às 16:00 !alta #contas me avise 30 minutos antes") mais uma lista `duvidas`; quem calcula datas e valida tudo é o parser de sempre (LLM erra conta de calendário). `reconcile(aiText, heard, local)` junta com o que as regras entenderam: **tira o que a IA inventou** (um item do parser sem nenhum sinal na fala, por `EVIDENCE`, que é largo de propósito), **confere o título** (1.7.0, pedido do dono: "somente o que de fato está falando, literal"), **devolve o que a fala tinha e a IA deixou cair**, e, se os dois divergem, vale a IA. Depende de `tokens[].text` do parser guardar só o texto do próprio item (foi corrigido na 1.6.0: antes o texto de "às 15:00" engolia o "!alta #etiqueta" vizinhos).

**Só o que foi dito** (1.7.0): em duas camadas. (1) O prompt (`AI_SYSTEM`) tem a "REGRA PRINCIPAL" de usar SÓ as palavras da pessoa (só tirar hesitações, repetições e o pedido, juntar partes e pôr o verbo no infinitivo) e um exemplo "marcar dentista" -> "Marcar dentista". (2) `isLiteral(título, fala)`: toda palavra de conteúdo do título da IA precisa aparecer na fala (sem acento e sem maiúsculas; ignora palavras de até 2 letras e de ligação como "para", "pro", "seu"; aceita a mesma palavra ou outra da mesma família pelos 4 primeiros caracteres, como reunião/reuniões; número em algarismos ou por extenso vale se a fala tinha número). Se falhar, `reconcile` troca só o **título** pelo das regras (`local.title`) e mantém o resto da IA (dia, hora...). Consequência aceita: a IA não "conserta" palavra que o reconhecimento errou; o título fica como foi reconhecido e a pessoa edita. Um teste de `tests/worker.test.js` confere que **todos os exemplos do próprio prompt** passam em `isLiteral`.

**Worker** (`worker/lembretes.js`): `POST /interpretar` com `Authorization: Bearer <idToken do Firebase>` e corpo `{ fala, hoje, agora }` (só isso): confere o token (`verifyFirebaseToken`: RS256 com as chaves públicas do Google em cache de 6 h, `aud`/`iss` = projeto `pauta-familia` (variável `FIREBASE_PROJECT_ID` troca), validade); limita por pessoa no D1 (`ia_uso`: 40 por hora e 150 por dia, **inclusive os recusados**); monta as mensagens (`buildMessages`: instruções + 10 exemplos como conversa + a frase em JSON); chama `env.AI.run` (modelo `AI_MODEL`, padrão Llama 3.3 70B fp8 fast, `temperature` 0.1, modo JSON nos modelos que aceitam); trata a resposta como **não confiável** (`cleanAiOutput`: primeiro JSON completo, uma linha, 300 caracteres, no máximo 3 dúvidas). Respostas: 200 `{ texto, duvidas }`; 400 frase vazia; 401 login inválido ou vencido; 413; 429 limite; 502 resposta inválida; 503 `ia_indisponivel` (sem o binding, limite grátis do dia, erro ou demora). **A frase não é guardada nem escrita em log** (o log traz só o motivo, "ia recusou: ...").

**O prompt foi testado** no AI Playground público da Cloudflare (<https://playground.ai.cloudflare.com>, sem usar a conta do dono) com 8 frases soltas; achou e corrigiu dois defeitos: o modelo apontava "quando a tarefa deve ser feita?" em tarefas sem data (agora o prompt diz que dia, hora etc. são opcionais e há um exemplo sem data) e, numa frase com "ignore as instruções", emendava um segundo JSON (`cleanAiOutput` pega só o primeiro, e há um exemplo para esse caso).

### Criar ou abrir o rascunho (`js/ui/composer.js` e `js/ui/editor.js`)

Ao terminar de falar, `finishVoice` chama `submit`: se `clear`, cria a tarefa na hora e mostra o que entendeu, com **Desfazer**; se houver dúvida, chama `app.editor.openDraft(campos, { heard, issues })`. O editor aceita um **rascunho**: uma tarefa que ainda não existe no `store`, editada só na memória com as mesmas regras (`mergePatch` + `createTask`); **Adicionar** chama `store.addTask`; fechar sem adicionar descarta com um aviso e **Desfazer** (`discardDraft`). Um lembrete pedido sem hora fica guardado em `draftInfo.wantRemind` e liga quando a hora for escolhida (a menos que a pessoa mexa no lembrete antes). O mesmo caminho vale para o ditado do teclado (campo com `spoken = true`).

**Limite do iPhone**: no app da Tela de Início o iOS, até onde se sabe, não oferece oficialmente o reconhecimento de voz do navegador (WebKit, bug 225298, fechado como "RESOLVED LATER"; a Apple respondeu que não está disponível nesse modo "por enquanto"). **Relato do dono em 09/11/2026**: no iPhone dele (app da Tela de Início) o aviso de permissão do microfone apareceu e foi aceito, mas **ele não conseguiu parar a gravação e/ou enviar o que falou** (1.5.0 e 1.6.0, que usavam `continuous = true`; a 1.4.1, de uma rodada só, funcionava mas cortava na primeira pausa). A causa **não foi confirmada** (sem iPhone aqui). Suspeitas, todas tratadas na 1.7.0: (a) o modo contínuo do Safari no iOS é instável (relatos da comunidade: o `onend` e o texto podem nunca chegar, `stop()` pode não soltar o microfone); (b) a espera da IA podia prender a tela: a renovação do login (`getToken`) não tinha prazo e `understandWithAi` não tinha `try/finally`; (c) `finish()` só avisava o fim (`onEnd`) depois da entrega do texto, sem proteção. O que a 1.7.0 faz (`js/speech.js`):
- **iPhone/iPad** (`isIos`): `continuous = false`; cada rodada vale por uma frase e `scheduleRestart` religa sozinho (o mesmo código que já juntava rodadas), então para quem fala é igual;
- **parar nunca depende do navegador**: `stop()` espera `IOS_STOP_GRACE_MS` (2 s no iPhone) ou `STOP_GRACE_MS` (3 s) e então `forceEnd` (abort + fim); **pedir para parar de novo** depois de `FORCE_STOP_MS` (600 ms) termina na hora (botão "Enviar agora"); erro sem `onend` termina em `ERROR_GRACE_MS` (1 s); `finish()` chama `onEnd` mesmo se `onFinal` der erro;
- **segundo plano** (só no iOS): `visibilitychange` para `hidden` depois de o navegador dar sinal de vida cancela a sessão (o texto já escrito fica no campo; nada é criado sem a pessoa olhando); se ainda não deu sinal de vida, ignora (o aviso de permissão do sistema pode esconder a página por um instante);
- **UI** (`composer.js`): o recado "Ouvindo..." tem o botão **Parar e enviar** (no iPhone não há Enter), "Entendendo o que você falou..." tem **Enviar agora**, e se 8 s depois de ligar nenhuma palavra apareceu o recado oferece o microfone do teclado;
- **relatório** (`speech.report()`): linha do tempo do último uso (eventos `start`, `onstart`, `result`, `stop`, `force-end`, `finish`, `ai-start`, `ai-end`, `created`... com milissegundos; **nunca o texto falado**), guardada em `pauta:voz-log` e copiável em Configurações > "Problemas com o microfone?". **Se o problema voltar, peça esse relatório primeiro**: ele diz se o iPhone chegou a dar `result`, se `onend` veio, e se travou antes ou depois da IA.

Desfechos que o app sempre tratou, desde a 1.4.1:
- erro explícito (`service-not-allowed`, `not-allowed`, `language-not-supported`, ou `aborted` antes de qualquer sinal de vida): mostra o aviso, **lembra por 7 dias** neste aparelho (chave `pauta:voz` no localStorage) e passa para o **microfone do teclado** (o ditado do iPhone; o texto ditado passa pelo mesmo `normalizeSpoken`);
- navegador mudo (aceita o `start` e não faz nada): ao parar, espera o prazo e então trata como recusa;
- funciona: tarefa criada como no computador.

Quando o app já sabe que o navegador recusou, o toque no microfone vai direto ao teclado, com o link **Tentar o microfone do app de novo** (apaga a lembrança e tenta). "Não permitido" só vira bloqueio lembrado no app do iPhone; no computador é escolha da pessoa e o navegador cuida disso.

## O que foi verificado e o que não foi

**Verificado em 09/11/2026 (versão 1.7.0, microfone sem travar, IA ligada por padrão e só o literal)**
- 341 testes automáticos no navegador (novos: `isIos`, iPhone sem modo contínuo e com rodadas juntadas, parada forçada com e sem o instante mínimo, fim avisado mesmo se a entrega do texto ou o próprio aviso do fim derem erro, erro sem fim, segundo plano no iPhone (e a exceção do aviso de permissão, e que no computador nada muda), relatório sem o texto falado e com tamanho limitado, IA ligada por padrão, escolha que vale sem armazenamento, aviso do primeiro uso, prazo que conta o login, pular a IA, `isLiteral` e o título fiel na `reconcile`, e que os exemplos do prompt obedecem a própria regra). O Node (GitHub Actions) é conferido depois de publicar.
- Interface no navegador embutido, no emulador (`http://localhost:8790/`), com um reconhecedor de voz **simulado** e um `fetch` falso só para `/interpretar`: com a IA **sem nunca ter sido ligada** (padrão) o pedido sai (`fala`, `hoje`, `agora`, nada mais) e o aviso do primeiro uso aparece uma vez; o recado "Ouvindo..." com **Parar e enviar**, "Entendendo o que você falou..." com **Enviar agora**, "Entendendo com IA..." com **Pular a IA**; a IA devolvendo "Marcar consulta no dentista amanhã às 15:00" para "marcar dentista amanhã às três da tarde" criou **"Marcar dentista"**, amanhã 15:00 (o título voltou ao dito; o dia e a hora da IA ficaram); **Pular a IA** seguiu em cerca de 100 ms com a IA demorando 8 s; navegador "mudo" (parar não termina): **Enviar agora** depois do instante mínimo terminou na hora, soltou o microfone e criou a tarefa; IA desligada em Configurações (`pauta:ia` = `off`): nenhuma chamada e a tarefa criada pelas regras; 8 s sem palavra: o aviso e a saída pelo microfone do teclado; Configurações: chave da IA já ligada, seção "Problemas com o microfone?" e relatório (no painel embutido o `clipboard` recusa, então apareceu o texto para copiar à mão).

**Verificado em 09/11/2026 (versão 1.6.0, IA da fala)**
- 320 testes automáticos no navegador: o Worker com **tokens RS256 assinados por uma chave RSA de verdade** (aceita o certo; recusa projeto errado, emissor errado, vencido, emitido no futuro, sem `sub`, algoritmo `none`/HS256, assinatura de outra chave, conteúdo trocado, lixo; chave nova do Google aprendida sem buscar a lista mais de uma vez por minuto; chaves do Google fora do ar = 503), limite por pessoa (40/h, 150/dia), resposta da IA tratada como não confiável, a frase não guardada, o cliente `js/ai.js` (todos os motivos de falha, timeout) e `reconcile`.
- Contra o mundo real: as chaves públicas **verdadeiras** do Google foram baixadas e importadas pelo mesmo caminho do Worker (2 chaves, `max-age` de umas 6 h); o SQL do contador (`INSERT ... ON CONFLICT`, `SELECT`, faxina) rodou no SQLite 3.45.
- Interface no navegador embutido com **resposta do serviço simulada** (um `fetch` falso só para `/interpretar`) e login no emulador: seção "Entender a fala com IA" (desligada por padrão; ligar; **Testar a IA** com sucesso, 503 e 429; o pedido sai com o token e só `fala`, `hoje` e `agora`); fala clara criando a tarefa direto pela linha da IA (título, dia, hora e lembrete); dúvida da IA abrindo o rascunho com "Você disse" original; dia, hora e prioridade inventados pela IA descartados; IA fora do ar (aviso e regras); Esc enquanto espera; ditado do teclado (modo app do iPhone) passando pela IA só quando ligada; texto digitado nunca enviado.
- Produção (Cloudflare): código novo implantado e binding `AI` criado pelo painel; `/health` devolve `"ia":true`; `/interpretar` sem login e com token falso = 401; o preflight do site (`https://mekea-dev.github.io`) libera `Authorization` e o de outro site não libera nada.
- Prompt testado com o modelo real no AI Playground público da Cloudflare (8 frases soltas; ver "IA opcional").
- **Ponta a ponta em produção, com o login real do dono** (site publicado, Chrome do computador dele, 1.6.0): Configurações, ligar a IA, **Testar a IA** devolveu "Ligar pro dentista amanhã às 15:00" em cerca de 2 s. Isso passou pelo login conferido com as chaves reais do Google, o contador no D1, o Workers AI, o CORS do site e a leitura da resposta no app. A IA ficou **ligada** nesse Chrome (`pauta:ia` = `on`). Depois de publicar, o GitHub Actions (Node 22) passou com os 320 testes (a primeira tentativa falhou só por um `unref` num relógio que o teste de "demora" precisava; corrigido).

**Verificado em 09/11/2026 (versão 1.5.0)**
- 290 testes automáticos no navegador. (O GitHub Actions, com Node 22, roda os mesmos; conferir o resultado depois de publicar.)
- Interface no navegador embutido do Claude Code, com um reconhecedor de voz **simulado** que a página recebe no lugar do real: gravação contínua com pausa no meio (o app religou sozinho, `starts: 2`, e juntou as duas partes), parar tocando no microfone e apertando Enter, parar sem ter falado nada ("Não ouvi nada"), digitar durante a gravação (cancela o microfone), Esc; frase clara criando a tarefa direto; frase sem título abrindo **Nova tarefa** com dia e hora preenchidos, título em branco e destacado, o que foi dito; Adicionar, Descartar e **Desfazer**; lembrete pedido sem hora ligando ao escolher a hora (e "15 minutos antes" avisando 15 min antes da hora escolhida); seletor de hora de 5 em 5 com todas as transições (minuto quebrado 16:07 -> 25, tirar a hora, escolher de novo); layout de celular (375 px) do rascunho.

**Verificado em 06/11/2026 (1.4.x)**
- 251 testes automáticos, no navegador e no GitHub Actions (Node 22).
- Interface no navegador embutido do Claude Code: voz simulada (criação da tarefa a partir da frase falada), pré-visualização e avisos de lembrete sem hora, linha Lembrete no editor, sino na lista, seção de avisos nas Configurações (estado "bloqueado"), layout de celular, e o microfone no modo "app do iPhone" simulado (recusa, bloqueio lembrado, "tentar de novo", navegador mudo).
- Produção: `/vapid` devolve 65 bytes; chamadas a partir de `https://mekea-dev.github.io` passam no CORS e na política de segurança; `/subscribe` e `/reminders` respondem 200, senha errada 403, endereço não permitido 400; o relógio de 1 minuto rodou e apagou um aparelho falso (o Google respondeu 404 ou 410).

**NÃO verificado**
- **Que o microfone parou de travar no iPhone**: a 1.7.0 foi escrita a partir de relatos (do dono e da comunidade) e de testes com um reconhecedor simulado, **sem iPhone**. Falta o dono tentar de novo no app da Tela de Início; se travar, o relatório do microfone (Configurações) diz onde. O `continuous = false` do iPhone e o religar automático também não foram vistos no Safari de verdade (o iOS pode repetir um som ou o aviso de permissão a cada rodada).
- **O prompt novo ("só o que foi dito") com o modelo real**: o código está testado, mas o texto do pedido só vale depois de colado no painel da Cloudflare (e conferido com **Testar a IA**). A conferência do app (`isLiteral`) vale mesmo sem isso.
- **A IA da fala no iPhone e com frases de verdade**: o teste ponta a ponta usou só a frase de exemplo do botão, no Chrome do computador (demora medida: cerca de 2 s, uma vez; o app desiste em 10 s). Também falta medir o **consumo real de neurons por frase** (a conta de ~40 a 45 é estimativa: ~1.300 tokens de entrada e ~50 de saída; dá para ver o uso no painel da Cloudflare, Workers AI). Com a IA ligada para todos e cadastro aberto, o limite grátis de 10.000 neurons por dia é da conta toda.
- Um aviso **chegando de verdade** num aparelho (o pedido de permissão do Chrome ficou sem resposta; o iPhone nunca foi testado).
- Reconhecimento de voz **real** (o navegador embutido bloqueia o microfone) e o que o iOS faz no modo app. Em especial na 1.5.0: se `continuous = true` e o religar automático da rodada se comportam bem no Chrome e no Safari de verdade (o iOS pode repetir um som ou o pedido de permissão a cada rodada), e que **confiança** o iPhone informa (afeta `LOW_CONFIDENCE`). As regras de `js/voice.js` foram escritas e testadas com frases que **eu escrevi**, não com transcrições reais: o mais provável de faltar é uma frase que o reconhecedor real escreve de outro jeito.
- Os dois seletores de hora na roda do iPhone (`<select>` nativo): a lista de minutos de 5 em 5 foi conferida só no navegador do computador.
- Em iPhone: Cache API do espelho, toque na notificação abrindo a tarefa (`#/tarefa/<id>`), e o pedido de permissão.
- Cadastro **sem código** com uma conta nova no Firebase real (só no simulador de regras e no emulador), redefinição de senha por e-mail, excluir conta, segundo aparelho real.

## Pendências

0. **Worker da 1.7.0 na Cloudflare** (09/11/2026): só o texto do pedido à IA (`AI_SYSTEM` e um exemplo) mudou em `worker/lembretes.js`; cole o arquivo no painel e faça **Deploy** (passos em "Armadilhas já encontradas") e confira com **Testar a IA**. O clique em Deploy feito pelo Claude Code foi bloqueado como "ação de produção", então depende do dono (ou de ele autorizar no chat). Sem isso o app já confere o título da IA (`isLiteral`); falta só a instrução ao modelo. Se já foi feito, apague esta linha.
1. **No iPhone** (fechar e abrir o app uma vez antes): Configurações, Avisos dos lembretes, Ligar avisos, **Testar com o app fechado**. Se falhar: a própria seção mostra o motivo; olhe também os Logs do Worker.
2. **Microfone no iPhone**: depois de publicar a 1.7.0 (fechar e abrir o app), falar uma tarefa, tocar em **Parar e enviar** e ver se a tarefa é criada (pausas no meio da frase não devem cortar). **Se travar de novo, Configurações > Problemas com o microfone? > Copiar relatório do microfone** e colar na conversa: é o dado que falta para achar a causa. Se o iPhone recusar de vez, decidir se vale uma das opções abaixo. **Anote as frases que o app entendeu errado** (o que foi dito, o que virou): são o melhor insumo para melhorar `js/voice.js`.
2a. **IA da fala** (já vem ligada): em **cada aparelho**, Configurações, **Entender a fala com IA**, tocar em **Testar a IA** (confere login, serviço e limite). Depois falar frases de verdade; se a IA demorar (mais de uns 5 s), errar ou trocar palavras que você não disse (o app já descarta, mas anote), anote a frase e o resultado para ajustar o prompt, o modelo ou o tempo (seção "A IA da fala: ajustes possíveis"). Conferir também o consumo real de neurons no painel da Cloudflare depois de alguns dias de uso.
3. **Restringir a chave de API do Firebase** por referrer (Google Cloud Console, APIs e serviços, Credenciais, chave do navegador: `https://mekea-dev.github.io/*` e `http://localhost:8789/*`). É configuração de segurança do dono da conta.
4. Teste de aviso de ponta a ponta no computador (seção acima).
5. Testes reais pendentes do Firebase: cadastro sem código, redefinição de senha, excluir conta, segundo aparelho. Depois, tirar do README a frase "testados com um Firebase de mentira".
6. Cosmético: o `package.json` ainda diz `"version": "1.0.0"` (não é usado).

### A IA da fala: ajustes possíveis

A IA da fala está implementada (seção "IA da fala", acima). Coisas que podem ser ajustadas conforme o uso real:
- **O prompt** (`AI_SYSTEM` e `AI_EXAMPLES` em `worker/lembretes.js`): frases que a IA entende mal viram novos exemplos (cada exemplo custa neurons em todo pedido). Há um teste que confere que todos os exemplos são JSON válido no formato certo.
- **O modelo** (variável `AI_MODEL` no painel, sem mexer no código): `@cf/meta/llama-3.1-8b-instruct-fp8-fast` custa cerca de 6 vezes menos, com menos qualidade; modelos de raciocínio (como os `gpt-oss`) gastam mais saída e demoram mais, não são indicados aqui. Só os modelos de `JSON_MODE_MODELS` usam o "modo JSON".
- **O tempo** (`TIMEOUT_MS` em `js/ai.js`, 10 s, contando a renovação do login): se a IA demorar mais que isso no uso real, o app cai nas regras. Medir a demora real no celular antes de mexer.
- **Chamar a IA só quando as regras deixarem dúvida** (hoje chama sempre que está ligada e a fala veio da voz): reduz custo e demora, e economiza o limite grátis do dia (que agora é de todos, com a IA ligada por padrão), mas perde a reescrita de títulos que as regras entendem "por baixo" (por exemplo, "Ligar pro Zé" vira "Ligar para o Zé").
- **A conferência do título** (`isLiteral`, `FUNCTION_WORDS`, `sameWord` em `js/ai.js`): se recusar títulos bons (o app cai no título das regras, que é o que foi dito), alargue `sameWord` (hoje 4 caracteres iniciais) ou a lista de palavras de ligação. Verbos irregulares ("fazer" na IA, "faço" na fala) não casam.
- **Limite por pessoa** (`LIMITS.iaPerDay`, 150, em `worker/lembretes.js`): como o cadastro é aberto e a IA vem ligada, uma única conta pode gastar até uns 6.700 neurons por dia (150 x ~45). Baixe o número se virar problema.

### Opção: microfone de verdade no app do iPhone (transcrição na Cloudflare)

**Não implementada; precisa da aprovação do dono** porque o **áudio da fala sai do aparelho** (hoje só horários saem).
- **Cliente**: `getUserMedia({ audio: true })` e `MediaRecorder`; decodificar com `AudioContext.decodeAudioData` e reamostrar para 16 kHz mono (`OfflineAudioContext`); codificar WAV; enviar para um endereço novo do Worker (`POST /transcrever`) com o token do Firebase em `Authorization: Bearer`. Ligar só se a pessoa aceitar nas Configurações (opção desligada por padrão) e dizer isso no README e em `LEMBRETES.md`.
- **Worker**: verificar o token do Firebase (RS256, chaves em `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`; conferir `aud` = `pauta-familia`, `iss` = `https://securetoken.google.com/pauta-familia`, `exp`); limitar por pessoa no D1 (por exemplo 60 por hora); chamar `env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio, language: 'pt' })` (binding `AI`, tipo Workers AI; confirmar na documentação o formato exato de `audio`); devolver `{ text }` e passar o texto por `normalizeSpoken`.
- **Custo**: o plano gratuito dá 10.000 neurons por dia; o modelo turbo custa cerca de 46,6 neurons por minuto de áudio (conferir em <https://developers.cloudflare.com/workers-ai/platform/pricing/>), ou seja, algo perto de 200 minutos por dia.
- **Riscos**: o iOS pode repetir o pedido de permissão do microfone no modo app (WebKit, bug 215884); não dá para testar sem um iPhone.
- **Testar sem microfone**: gerar um WAV falado com o Windows (`System.Speech.Synthesis`, voz em português) e enviar ao endereço.
- Alternativas já descartadas: aplicativo nativo (exige conta de desenvolvedor paga) e Atalhos do iOS (abrem o Safari, que tem armazenamento separado do app).

## Ideias (nada disso foi pedido)

- Tratar `pushsubscriptionchange` no `sw.js` (o navegador pode trocar a inscrição; hoje o app refaz na próxima abertura).
- Adiar um lembrete ("daqui a 10 minutos") a partir da notificação (iOS não mostra botões em notificação web).
- Listas compartilhadas **entre pessoas** (hoje cada conta tem as próprias tarefas; "compartilhar" foi entendido como sincronia entre os aparelhos da mesma pessoa).

## Decisões e motivos

- **Sem build, sem servidor, sem rastreamento**: o dono queria algo simples que rodasse direto no GitHub Pages ("não quero ganhar dinheiro com isso"). Por isso o Firebase é usado por REST, sem SDK.
- **Repositório público, licença MIT**: pesquisado e descartado deixar privado (o Pages gratuito só publica de repositório público; o front-end é sempre baixável por qualquer visitante de qualquer jeito).
- **Cadastro aberto e login obrigatório**: pedido do dono. Risco: contas de spam podem encher a cota gratuita do Firebase sem afetar os dados dos outros. Voltar atrás: `exigirConvite: true`, regras com código (`docs/regras-banco.json`) e o item `convite` no banco.
- **Toque sem conteúdo (Web Push)**: o iPhone não agenda notificação local e o GitHub Pages não executa código; precisava de um serviço. Mandar só o "toque" faz com que os títulos nunca saiam do aparelho.
- **Cloudflare Worker + D1 + cron de 1 minuto**: gratuito e sem servidor para cuidar. A precisão do aviso é de 1 minuto.
- **Microfone do navegador com reserva no teclado**: a única opção gratuita e sem enviar áudio a lugar nenhum.
- **A fala é entendida por regras, no aparelho, e a IA complementa** (1.5.0, 1.6.0 e 1.7.0): o dono quis que a fala "faça sentido" como no Claude ou nas legendas do Meet. As regras cobrem o que é previsível (pedido, hesitações, intenção, horas, correções) sem enviar nada para fora; a IA (Workers AI da Cloudflare, aprovada em 09/11/2026 depois de ele saber que o texto falado sai do aparelho e que não custa nada no uso dele) vinha **desligada por padrão** na 1.6.0, porque o cadastro é aberto e outras pessoas usam o app sem terem aceitado isso.
- **IA ligada por padrão, com aviso e saída** (1.7.0): o dono pediu ("sem ter que ativar e/ou desativar"). Para continuar honesto com quem se cadastra: aviso no primeiro uso, texto claro em Configurações, desligar por aparelho, e a IA nunca é necessária (falhou, demorou ou está desligada, valem as regras). Custo/risco aceito: o limite grátis de 10.000 neurons por dia é da conta toda, então muitos usuários esgotam o dia mais cedo (a IA para sozinha, sem cobrança). Voltar atrás: em `ownChoice`/`isOn` de `js/ai.js`, trocar `!== 'off'` por `=== 'on'`, e ajustar os textos e os testes.
- **O título da IA só vale com palavras da fala** (1.7.0): pedido do dono ("somente o que de fato está falando, literal"). Escolhido o rigor (recusar a palavra trocada, mesmo parecida) porque o preço de recusar à toa é pequeno (vale o título das regras, que é o que foi dito) e o de aceitar uma palavra inventada é uma tarefa com o nome errado sem a pessoa notar.
- **No iPhone, sem modo contínuo** (1.7.0): é o que a comunidade recomenda e é coerente com o relato do dono (a 1.4.1, de uma rodada, parava; a 1.5.0 e a 1.6.0, contínuas, travavam). Não é prova: sem iPhone aqui, o relatório do microfone existe para que o próximo defeito venha com dados.
- **IA como "reescritor" com conferência, não como "intérprete"** (1.6.0): a IA devolve uma linha na sintaxe do adicionar rápido e o parser de sempre calcula as datas; `reconcile` descarta o que ela inventou. Motivos: modelos erram contas de calendário, e assim a mesma validação das frases digitadas vale para a IA.
- **Modelo padrão: Llama 3.3 70B fp8 fast** (1.6.0): melhor português que os de 8B e aceita o modo JSON; cerca de 6 vezes mais caro que o 8B fp8 fast por frase, mas ainda gratuito no uso do dono. Troca por variável (`AI_MODEL`), sem mexer no código.
- **Quando não fica claro, não chuta, abre o rascunho** (1.5.0): pedido do dono, com a condição de "não ser retrabalho". Por isso o rascunho já vem com o que foi entendido, diz o que ficou em dúvida e guarda o pedido de lembrete até a hora ser escolhida; quando tudo fica claro, a tarefa é criada direto.
- **Hora com minutos de 5 em 5 em duas caixas** (1.5.0): o `<input type="time" step="300">` não garante a roda de 5 em 5 no iPhone; `<select>` nativo garante. O minuto "quebrado" de uma tarefa existente continua na lista para não ser alterado sem querer.
- **Escopo enxuto**: o dono prefere ferramentas simples e diretas, "não um Trello da vida"; extras só como oferta.

## Armadilhas já encontradas

- Módulos e service worker precisam de `http://localhost` (ou https): não abrem por duplo clique.
- Mudou o `sw.js` ou a lista `ASSETS`? Suba a versão: o nome do cache muda e os arquivos antigos saem do aparelho.
- No editor de código do painel da Cloudflare, colar funciona (Ctrl+A, Ctrl+V **dentro** do editor, depois de ele carregar); depois clique em **Deploy**. Mudar variáveis ou bindings pelo painel cria uma nova implantação.
- O navegador embutido do Claude Code e o Chrome controlado por extensão **não conseguem clicar em pedidos de permissão do navegador** (notificações, microfone): isso exige uma pessoa.
- Testes que usam relógios reais (`tests/speech.test.js`, `tests/alerts.test.js`) esperam alguns milissegundos; a suíte inteira leva uns 15 s no navegador.
- Os testes de `tests/site.test.js` proíbem emojis e setas: para setas em texto, use `->` ou `>`.
- **Testar a IA sem gastar a conta do dono nem precisar de token**: o AI Playground público da Cloudflare (<https://playground.ai.cloudflare.com/models?model=%40cf%2Fmeta%2Fllama-3.3-70b-instruct-fp8-fast>). Cole as instruções (`AI_SYSTEM` + exemplos) em "Instructions", **desligue as ferramentas** ("Developer Stack MCP": botão Clear) ou o modelo tenta chamar funções, e mande a frase no formato JSON do Worker. A tela às vezes mostra o texto da resposta **embaralhado** (trechos duplicados e entrelaçados); dá para decifrar, e a "verificação de segurança" deles cai de vez em quando ("Safety check unavailable": é só tentar mais tarde).
- Para colar o Worker no painel da Cloudflare pelo Chrome: abra `http://localhost:8789/worker/lembretes.js`, `Ctrl+A`, `Ctrl+C`; no editor do Worker (`.../workers/services/edit/pauta-lembretes/production`) clique dentro, `Ctrl+A`, `Ctrl+V`, confira o número de linhas na barra de baixo e **Deploy**. O binding `AI` (Workers AI) vai em Settings, Bindings, Add binding.
- Se o microfone do app "não funciona" num teste (ou o simulador de reconhecimento não é chamado), apague `pauta:voz` do localStorage: um teste anterior pode ter deixado a recusa lembrada por 7 dias.
- O painel do navegador do Claude Code pode estar **escondido** (a janela minimizada): screenshot e clique falham com "Screenshot timed out". Dá para dirigir a página só com `javascript_tool` (`.click()`, `.value` mais o evento `input`) e `get_page_text`; para testar o microfone, ponha uma classe falsa em `window.webkitSpeechRecognition` (e em `SpeechRecognition`) com `start`, `stop`, `abort` e `say(texto)`, e um `window.fetch` falso para `/interpretar`.
- Em testes que dependem de a IA estar ligada ou desligada, lembre que **sem escolha feita ela está ligada**: `store(null)` nos testes de `tests/ai.test.js` é "ligada".
- Trocar as opções de um `<select>` (`replaceChildren`) **zera o valor escolhido**: sempre reaplique o valor depois (foi um bug do seletor de minutos na 1.5.0, só visível ao trocar 07 por 05 com o seletor em foco).
- `parseQuickAdd` só entende número por extenso até "dez" (`NUM` em `js/parser.js`); `js/voice.js` converte os maiores para dígitos antes. Número por extenso em outro contexto novo precisa de uma regra lá.
- Datas inválidas ("31 de abril") ainda podem virar outra data silenciosamente (`dia 31` vira o próximo dia 31 e sobra "de abril" no título); não é detectado como dúvida.
- Tarefa que repete (`todo dia às 7h`) criada depois das 7h começa **hoje** (já atrasada): vem do `firstOccurrence` do parser, não da fala.
- A ferramenta de edição do Claude Code converte sequências `\uXXXX` em glifos; para escapes exatos, use PowerShell.
