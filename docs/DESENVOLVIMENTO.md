# Guia para continuar o desenvolvimento

Este guia existe para você (ou um assistente, como o Claude Code) retomar o Pauta em outro computador **sem depender da conversa em que ele foi feito**. Ele diz onde as coisas estão, como rodar e testar, o que já foi feito e verificado, o que falta, o que foi decidido e por quê, e as armadilhas que já apareceram.

Última atualização: 06/11/2026, versão **1.4.1**. O histórico de versões está em [CHANGELOG.md](../CHANGELOG.md). As instruções curtas para o Claude Code estão em [CLAUDE.md](../CLAUDE.md).

## Primeiros passos em outro computador

1. `git clone https://github.com/mekea-dev/pauta.git` e entre na pasta.
2. Suba um servidor local (módulos JavaScript e service worker não funcionam abrindo o arquivo com duplo clique):
   - Windows, sem instalar nada: `powershell -NoProfile -ExecutionPolicy Bypass -File .\servir.ps1` (abre em `http://localhost:8789/`).
   - Qualquer sistema com Python: `python -m http.server 8789`.
3. Abra `http://localhost:8789/tests/`. Deve aparecer **OK** com todos os testes (251 em 06/11/2026). Com Node 18 ou mais novo: `node --test` (o GitHub Actions usa o Node 22).
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
| `worker/lembretes.js` | **serviço de lembretes** (Cloudflare Worker). Não faz parte do site: é colado no painel da Cloudflare |
| `js/config.js` | nome, **versão** (`APP_VERSION`) e chaves de armazenamento |
| `js/dates.js` | datas como texto `AAAA-MM-DD` (sem fuso), nomes e formatos em português |
| `js/text.js` | `fold` (minúsculas, sem acento, mesmo tamanho) e ajudantes de plural |
| `js/recurrence.js` | regras de repetição (todo dia, dias úteis, a cada N semanas...) |
| `js/parser.js` | adicionar rápido em português: data, hora, prioridade, etiquetas, repetição e **lembrete** ("me avise 15 minutos antes") |
| `js/voice.js` | `normalizeSpoken`: tira o "pedido falado" ("crie uma tarefa com título...") e troca números por extenso por dígitos, para o parser entender |
| `js/model.js` | tarefa, etiqueta, estado; `createTask`, `sanitizeTask`, `cleanRemind` |
| `js/store.js` | estado em memória, desfazer, operações (`addTask`, `updateTask`, `toggleDone`...) |
| `js/persist.js` | localStorage (`pauta:v1`) com reserva em memória e cópia do que estiver corrompido |
| `js/query.js` | filtros, ordenação, contagens e busca |
| `js/io.js` | backup JSON, planilha CSV (a coluna Lembrete é a última), importar e mesclar |
| `js/reminders.js` | contas dos lembretes: quando avisar, o que já está na hora, texto do aviso |
| `js/alerts.js` | **motor dos lembretes**: relógio de 20 s, espelho de avisos (Cache API), envio da lista ao serviço, ligar, desligar e testar |
| `js/push.js` | inscrição Web Push e conversa com o serviço de lembretes |
| `js/push-config.js` | endereço do serviço (`workerUrl`) |
| `js/speech.js` | microfone (Web Speech), bloqueio lembrado e limites de tempo |
| `js/main.js` | ponto de entrada: dados, rotas, ligação das peças, service worker |
| `js/sync/merge.js` | mescla das tarefas entre aparelhos (a mais recente vence; lápides de 90 dias) |
| `js/cloud/` | login e banco do Firebase por REST (`firebase.js`), motor de sincronização (`sync.js`), regras de conta (`account.js`) e a configuração (`config.js`) |
| `js/ui/` | a tela: `composer` (campo de adicionar e microfone), `editor`, `taskrow`, `views`, `calendar`, `sidebar`, `topbar`, `settings`, `account`, `actions`, `overlay`, `notify`, `icons`, `shortcuts`, `dom` |
| `scripts/emulador-nuvem.py` | "Firebase de mentira" local (login, banco e as mesmas regras do guia) |
| `scripts/gerar-icones.ps1` | recria os PNGs dos ícones |
| `tests/` | testes (Node e navegador); `tests/shim/` faz o `node:test` funcionar no navegador |
| `docs/` | guias (`NUVEM.md`, `LEMBRETES.md`, este), regras do banco (`regras-banco*.json`) e imagens do README |

### Testes (251 em 06/11/2026)

`dates`, `recurrence`, `parser`, `voice` (frases faladas), `reminders` (contas), `speech` (microfone), `push` (inscrição), `alerts` (motor), `sw` (o `sw.js` roda dentro de um navegador de mentira: `push` e `notificationclick`), `worker` (o serviço, inclusive a assinatura VAPID), `model`, `query`, `store`, `merge`, `cloud` (Firebase de mentira), `io` e `site` (consistência do pacote do site).

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
| `GET /vapid` | - | `{ publicKey }` (base64 de URL, 65 bytes) |
| `POST /subscribe` | `{ endpoint, auth }` (ou `keys.auth`) | `{ ok }`; 400 se o endereço não for do Google, Apple, Mozilla ou Microsoft; 403 se o endereço já existe com outra senha |
| `PUT /reminders` | `{ endpoint, auth, reminders: [{ id, at }] }` | troca a lista do aparelho; aceita `at` de 1 h atrás até 60 dias à frente, até 100 avisos; 403 com senha errada |
| `DELETE /subscription` | `{ endpoint, auth }` | apaga o aparelho |
| `GET /` ou `/health` | - | `{ ok: true, ... }` |

O `auth` é a chave da inscrição push (só o aparelho e o serviço de aviso a conhecem); o serviço guarda só o hash dela. A cada minuto (`scheduled`): pega até 40 aparelhos com aviso vencido, envia o toque (`Authorization: vapid t=..., k=...`, `TTL: 3600`, `Urgency: high`); 2xx apaga os avisos vencidos; 404 ou 410 apaga o aparelho; outro código soma uma tentativa (6 no máximo) e registra `push recusado` no log. Uma vez por hora (minuto 0) apaga avisos com mais de 2 dias ou sem tentativas restantes e aparelhos sem avisos há mais de 90 dias.

**Testar o aviso de ponta a ponta no computador** (o que **ainda não foi feito**, porque exige que uma pessoa clique em "Permitir" no pedido do navegador):
1. No painel da Cloudflare, acrescente `http://localhost:8790` a `ALLOWED_ORIGINS` (e **remova depois**).
2. Suba o emulador (`python scripts/emulador-nuvem.py --porta 8790`), crie uma conta de teste nele e abra `http://localhost:8790/` no Chrome.
3. Configurações, Avisos dos lembretes, **Ligar avisos**; clique em Permitir; depois **Testar com o app fechado**.
4. Em até 2 minutos deve aparecer a notificação do Chrome. Se não aparecer: D1 Console (`SELECT COUNT(*) FROM subs`, `SELECT COUNT(*) FROM reminders`) e os Logs do Worker.

## A voz por dentro

`js/speech.js` usa a Web Speech API do navegador (`SpeechRecognition` ou `webkitSpeechRecognition`), em `pt-BR`. `js/voice.js` (`normalizeSpoken`) transforma a frase falada em texto que o `parser.js` entende: tira "quero que crie uma tarefa com título", "com prazo para", troca "dia dez", "às quatro e meia da tarde" etc. por dígitos, e entende "com prioridade alta" e "com a etiqueta trabalho". Ele **não** come títulos legítimos: "Criar relatório mensal" fica como está (só se tira o pedido quando ele é inequívoco: tem "tarefa" ou "lembrete", ou começa com "quero que", "por favor", "me lembre de").

Ao terminar de falar, o campo (`js/ui/composer.js`) cria a tarefa na hora e mostra o que entendeu, com **Desfazer**. Se faltar o título, deixa o texto no campo.

**Limite do iPhone**: no app da Tela de Início o iOS, até onde se sabe, não oferece o reconhecimento de voz do navegador (WebKit, bug 225298, fechado como "RESOLVED LATER"; a Apple respondeu que não está disponível nesse modo "por enquanto"). Não foi achado sinal de correção no iOS 26, mas **não foi testado num iPhone de verdade**. Por isso, desde a 1.4.1 o app **tenta mesmo assim** e se prepara para três desfechos:
- erro explícito (`service-not-allowed`, `not-allowed`, `language-not-supported`, ou `aborted` antes de qualquer sinal de vida): mostra o aviso, **lembra por 7 dias** neste aparelho (chave `pauta:voz` no localStorage) e passa para o **microfone do teclado** (o ditado do iPhone; o texto ditado passa pelo mesmo `normalizeSpoken`);
- navegador mudo (aceita o `start` e não faz nada): ao tocar para parar, espera 3 s e então trata como recusa;
- funciona: tarefa criada como no computador.

Quando o app já sabe que o navegador recusou, o toque no microfone vai direto ao teclado, com o link **Tentar o microfone do app de novo** (apaga a lembrança e tenta). Ouvir tem limite de 30 s. "Não permitido" só vira bloqueio lembrado no app do iPhone; no computador é escolha da pessoa e o navegador cuida disso.

## O que foi verificado e o que não foi

**Verificado em 06/11/2026**
- 251 testes automáticos, no navegador e no GitHub Actions (Node 22).
- Interface no navegador embutido do Claude Code: voz simulada (criação da tarefa a partir da frase falada), pré-visualização e avisos de lembrete sem hora, linha Lembrete no editor, sino na lista, seção de avisos nas Configurações (estado "bloqueado"), layout de celular, e o microfone no modo "app do iPhone" simulado (recusa, bloqueio lembrado, "tentar de novo", navegador mudo).
- Produção: `/vapid` devolve 65 bytes; chamadas a partir de `https://mekea-dev.github.io` passam no CORS e na política de segurança; `/subscribe` e `/reminders` respondem 200, senha errada 403, endereço não permitido 400; o relógio de 1 minuto rodou e apagou um aparelho falso (o Google respondeu 404 ou 410).

**NÃO verificado**
- Um aviso **chegando de verdade** num aparelho (o pedido de permissão do Chrome ficou sem resposta; o iPhone nunca foi testado).
- Reconhecimento de voz **real** (o navegador embutido bloqueia o microfone) e o que o iOS faz no modo app.
- Em iPhone: Cache API do espelho, toque na notificação abrindo a tarefa (`#/tarefa/<id>`), e o pedido de permissão.
- Cadastro **sem código** com uma conta nova no Firebase real (só no simulador de regras e no emulador), redefinição de senha por e-mail, excluir conta, segundo aparelho real.

## Pendências

1. **No iPhone** (fechar e abrir o app uma vez antes): Configurações, Avisos dos lembretes, Ligar avisos, **Testar com o app fechado**. Se falhar: a própria seção mostra o motivo; olhe também os Logs do Worker.
2. **Microfone no iPhone**: ver se o app da Tela de Início aceita o reconhecimento de voz (1.4.1). Se recusar (esperado), decidir se vale a opção abaixo.
3. **Restringir a chave de API do Firebase** por referrer (Google Cloud Console, APIs e serviços, Credenciais, chave do navegador: `https://mekea-dev.github.io/*` e `http://localhost:8789/*`). É configuração de segurança do dono da conta.
4. Teste de aviso de ponta a ponta no computador (seção acima).
5. Testes reais pendentes do Firebase: cadastro sem código, redefinição de senha, excluir conta, segundo aparelho. Depois, tirar do README a frase "testados com um Firebase de mentira".
6. Cosmético: o `package.json` ainda diz `"version": "1.0.0"` (não é usado).

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
- **Escopo enxuto**: o dono prefere ferramentas simples e diretas, "não um Trello da vida"; extras só como oferta.

## Armadilhas já encontradas

- Módulos e service worker precisam de `http://localhost` (ou https): não abrem por duplo clique.
- Mudou o `sw.js` ou a lista `ASSETS`? Suba a versão: o nome do cache muda e os arquivos antigos saem do aparelho.
- No editor de código do painel da Cloudflare, colar funciona (Ctrl+A, Ctrl+V **dentro** do editor, depois de ele carregar); depois clique em **Deploy**. Mudar variáveis ou bindings pelo painel cria uma nova implantação.
- O navegador embutido do Claude Code e o Chrome controlado por extensão **não conseguem clicar em pedidos de permissão do navegador** (notificações, microfone): isso exige uma pessoa.
- Testes que usam relógios reais (`tests/speech.test.js`, `tests/alerts.test.js`) esperam alguns milissegundos; a suíte inteira leva uns 15 s no navegador.
- Os testes de `tests/site.test.js` proíbem emojis e setas: para setas em texto, use `->` ou `>`.
- A ferramenta de edição do Claude Code converte sequências `\uXXXX` em glifos; para escapes exatos, use PowerShell.
