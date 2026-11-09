# Pauta: instruções para o Claude Code

Pauta é uma agenda de tarefas (site estático em JavaScript puro, sem build) publicada no GitHub Pages, com login e sincronização opcionais (Firebase) e lembretes por notificação (serviço na Cloudflare).

**Leia primeiro [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md)**: estado atual, mapa do código, o que foi verificado e o que não, pendências e decisões. O histórico está em [CHANGELOG.md](CHANGELOG.md). Quem usa é uma pessoa que prefere ferramentas **simples e diretas** ("não um Trello da vida"): escopo enxuto e bem acabado; extras só como oferta, nunca por conta própria. Fale em português do Brasil, em linguagem simples.

## Comandos

- Servidor local: `powershell -NoProfile -ExecutionPolicy Bypass -File .\servir.ps1` (Windows, porta 8789) ou `python -m http.server 8789`.
- Testes: abra `http://localhost:8789/tests/` (navegador) ou rode `node --test` (Node 18 ou mais novo). **Rode antes de todo commit.**
- Emulador do Firebase (login sem a nuvem real): `python scripts/emulador-nuvem.py --porta 8790`, código de convite `FAMILIA2026`.

## Regras que os testes cobram

- `APP_VERSION` (`js/config.js`) e `VERSION` (`sw.js`) iguais. Suba a versão quando o app mudar.
- Arquivo novo em `js/`, `css/` ou `icons/` entra na lista `ASSETS` do `sw.js`.
- **Nada de emojis nem símbolos pictográficos** (setas, marcas, bolinhas) em JS, CSS, HTML e nos `.md` do projeto: ícones só pelos SVG do Lucide em `js/ui/icons.js`. Em texto, use `->`.
- Nada de `innerHTML`, `insertAdjacentHTML` ou `document.write` fora de `js/ui/icons.js`. Texto da pessoa entra como texto.
- Caminhos relativos (o site roda em `/pauta/`). Sem script ou estilo embutido (política de segurança no `index.html`); o endereço do serviço de lembretes (`js/push-config.js`) precisa estar no `connect-src`.
- O cache do espelho de avisos (`avisos-v1`) não pode começar com `pauta-`.
- `worker/lembretes.js` é um arquivo só, sem dependências. O código que roda na Cloudflare precisa ser igual ao do repositório: depois de mudar, cole no painel e faça Deploy.

## Como trabalhar

- Comentários e mensagens de interface em português. Código simples, sem dependências novas.
- **Nunca coloque segredos no repositório** (senhas, tokens, chaves privadas, e-mails pessoais). A `apiKey` do Firebase para web é pública por desenho; a chave VAPID privada existe só no banco D1 do Worker.
- Não crie contas nem digite senhas ou chaves em formulários de terceiros. Contas de teste só no emulador local.
- Publicar é `git push` na `main` (GitHub Pages): só faça quando o dono pedir ou já tiver autorizado. Identidade dos commits: `Leonardo Maquea <333067854+mekea-dev@users.noreply.github.com>` (via `-c user.name=... -c user.email=...`; não use e-mail pessoal ou do trabalho). No PowerShell 5.1, use `git commit -F arquivo` (aspas na mensagem quebram o `-m`).
- **A fala é interpretada no aparelho, por regras (`js/voice.js`), e passa também por uma IA** (`js/ai.js` + rota `/interpretar` do Worker, Workers AI da Cloudflare, aprovado pelo dono em 09/11/2026). Ela vem **ligada por padrão** (o dono pediu na 1.7.0; antes vinha desligada) e cada aparelho pode desligar em **Entender a fala com IA**, nas Configurações; no primeiro uso aparece um aviso. Só o **texto falado** sai do aparelho (a IA também decide se a fala é para criar, concluir, alterar ou excluir; **quem acha a tarefa é o aparelho**, `js/match.js`: os **títulos das tarefas nunca vão à IA**); nunca guarde nem escreva em log a frase no serviço, e mudar **quais dados saem do aparelho** (por exemplo mandar títulos de tarefas à IA) ou trocar de provedor de IA exige nova aprovação do dono. Alterar e excluir por voz sempre pedem confirmação; concluir tem "Desfazer". A IA só pode usar **o que a pessoa disse**: o prompt manda e o app confere (`isLiteral` e `reconcile`), e a resposta dela é sempre tratada como não confiável. **Nada na espera da IA ou do microfone pode prender a tela** (prazos, **Pular a IA**, **Parar e enviar**, `onEnd` sempre). Ao mexer nas regras da fala, rode e atualize os testes de `tests/voice.test.js`, inclusive os de **títulos comuns que não podem mudar**.
- Seja honesto sobre o que foi e o que não foi testado: **push de verdade (notificação chegando) e o iPhone nunca foram testados** até 09/11/2026 (o dono relatou que no iPhone o microfone pediu permissão e depois travou; a 1.7.0 trata isso **sem confirmação num aparelho**, e o relatório do microfone em Configurações existe para o próximo defeito); veja a lista em `docs/DESENVOLVIMENTO.md`.
