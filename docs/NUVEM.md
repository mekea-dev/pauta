# Login e sincronização entre aparelhos (opcional)

Por padrão, o Pauta guarda as tarefas só no navegador de cada aparelho. Seguindo este guia você liga o **login por e-mail e senha** e a **sincronização**: cada pessoa cria a própria conta e vê as mesmas tarefas no celular, no notebook e no PC.

Usa o **Firebase** (do Google) no plano gratuito (Spark): sem cartão de crédito, sem servidor seu e sem instalar nada. Leva uns 15 minutos. Enquanto você não preencher `js/cloud/config.js`, nenhuma tela de conta aparece e o app continua funcionando só no aparelho, como antes.

Resumo: criar o projeto, ligar o login por e-mail e senha, criar o banco, colar as regras de segurança (cadastro aberto ou com código de convite) e copiar duas informações para o app.

## Antes de começar

### Privacidade (avise as pessoas que você convidar)

- As tarefas de quem criar conta ficam guardadas no **seu** projeto Firebase, nos servidores do Google. Como administrador, você consegue ver os e-mails (em Authentication) e os dados (em Realtime Database). As regras impedem que uma pessoa leia os dados de outra, mas não impedem você.
- As senhas ficam com o Firebase Authentication. O Pauta nunca guarda a senha: depois de entrar, guarda no aparelho só um "token" de acesso.
- Os dados **não** têm criptografia de ponta a ponta. Para amigos e família é razoável, mas não guarde segredos (senhas, dados de cartão) nas tarefas.
- O app mostra um aviso parecido na tela de criar conta.

### O repositório pode ficar público sem expor nada

O GitHub Pages gratuito exige repositório público, e isso **não** vaza senhas nem tarefas:

| Fica no repositório (público) | Fica no Firebase (protegido) |
|---|---|
| O código do app | E-mails e senhas (Authentication) |
| A chave de API e o endereço do banco, em `js/cloud/config.js` | As tarefas de cada pessoa (Realtime Database, com regras) |
| Nenhuma senha, token ou tarefa de ninguém | O código de convite (se você usar a opção B do passo 4) |

- A chave de API do Firebase para web **não é segredo**: ela só identifica o projeto, e o navegador de qualquer visitante a recebe (mesmo com repositório privado). Quem protege os dados são o login e as regras do banco. A documentação do Firebase diz que essas chaves podem ficar no código e em arquivos de configuração. O [passo 8](#passo-8---restringir-a-chave-de-api-recomendado) restringe a chave ao seu site, como camada extra.
- Pode chegar um e-mail automático do Google ou do GitHub falando de uma "chave de API pública". Para a chave web do Firebase isso é esperado: confirme que é a chave "Browser key" do projeto e que ela está restrita (passo 8).
- O único dado pessoal no projeto é o seu nome no arquivo `LICENSE` (direitos autorais). Troque por seu usuário do GitHub se preferir.

### E se eu quiser o repositório privado?

No plano gratuito do GitHub, deixar o repositório privado **tira o site do ar** (o Pages gratuito só publica repositório público). Planos pagos publicam a partir de repositório privado, mas o endereço do site continua aberto na internet; só o GitHub Enterprise Cloud (organizações) restringe quem acessa o site. Para ter o repositório privado **e** o site funcionando de graça, publique em outro serviço de sites estáticos, como Cloudflare Pages ou Netlify, ligado ao repositório privado ou enviando a pasta. O Pauta usa só caminhos relativos e deve funcionar em qualquer endereço (não testei esses serviços). Se você restringir a chave de API por site (passo 8), inclua o endereço novo na lista.

## Passo 1 - Criar o projeto

1. Entre em <https://console.firebase.google.com> com uma conta Google (pode ser a pessoal).
2. Clique em **Criar um projeto** (Add project), dê um nome (por exemplo `pauta-familia`) e continue.
3. Na etapa do Google Analytics, **desative** (o Pauta não usa) e clique em **Criar projeto**.

## Passo 2 - Ligar o login por e-mail e senha

1. No menu da esquerda, abra **Criação** (Build) > **Authentication** e clique em **Vamos começar** (Get started).
2. Na aba **Método de login** (Sign-in method), escolha **E-mail/senha** (Email/Password).
3. Ligue a **primeira chave** (E-mail/senha) e deixe desligado o "Link por e-mail (login sem senha)". Clique em **Salvar**.

## Passo 3 - Criar o banco de dados

1. No menu, abra **Criação** > **Realtime Database** e clique em **Criar banco de dados** (Create database).
2. Escolha o local. Qualquer um serve; o padrão (Estados Unidos) é o mais comum.
3. Escolha **Iniciar no modo bloqueado** (Locked mode) e confirme.
4. Na aba **Dados**, copie o endereço do banco que aparece no topo. Ele é parecido com `https://pauta-familia-default-rtdb.firebaseio.com` (em outros locais termina em `firebasedatabase.app`, por exemplo `https://pauta-familia-default-rtdb.europe-west1.firebasedatabase.app`). Você vai usá-lo no passo 6.

## Passo 4 - Colar as regras de segurança

As regras são o que protege os dados: o app roda no navegador de cada pessoa, então quem decide quem pode ler e gravar o quê é o banco.

1. Ainda em **Realtime Database**, abra a aba **Regras** (Rules).
2. Escolha **uma** das duas opções abaixo: apague o conteúdo da aba e cole o texto dela.
3. Clique em **Publicar** (Publish).

As regras e a opção `exigirConvite` do [passo 6](#passo-6---copiar-duas-informações-para-o-app) **têm que combinar**: opção A com `exigirConvite: false`, opção B com `exigirConvite: true`.

### Opção A: cadastro aberto (quem tiver o endereço do site cria a conta)

A mais simples: não existe código. É o mesmo arquivo [`regras-banco-aberto.json`](regras-banco-aberto.json). Pule o passo 5.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "newData.hasChildren(['v', 'updatedAt', 'sig', 'blob'])",
        "v": { ".validate": "newData.isNumber()" },
        "updatedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
        "sig": { ".validate": "newData.isString() && newData.val().length <= 100" },
        "blob": { ".validate": "newData.isString() && newData.val().length <= 1000000" },
        "$outro": { ".validate": false }
      }
    }
  }
}
```

Cuidado com o cadastro aberto: qualquer pessoa com o endereço do site pode criar conta e guardar até cerca de 1 MB de tarefas no seu projeto. No plano gratuito (Spark) não há cobrança; o teto é o limite do plano (1 GB de dados), e quem abusar se resolve apagando os usuários no console. Se isso virar problema, passe para a opção B.

### Opção B: só entra quem tiver um código de convite

Bom para um grupo fechado de amigos e família. É o mesmo arquivo [`regras-banco.json`](regras-banco.json). Depois de publicar, faça o passo 5.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid && (data.exists() || (newData.child('convite').isString() && newData.child('convite').val() === root.child('convite').val()))",
        ".validate": "newData.hasChildren(['v', 'updatedAt', 'sig', 'blob'])",
        "v": { ".validate": "newData.isNumber()" },
        "updatedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
        "sig": { ".validate": "newData.isString() && newData.val().length <= 100" },
        "blob": { ".validate": "newData.isString() && newData.val().length <= 1000000" },
        "convite": { ".validate": "newData.isString() && newData.val().length <= 100" },
        "$outro": { ".validate": false }
      }
    }
  }
}
```

O que as regras fazem, nas duas opções:

- Cada pessoa lê e grava **só o próprio documento** (`users/<id da pessoa>`). Ninguém lista nem lê o das outras.
- Só são aceitos os campos que o app usa, com tamanho limitado (cerca de 1 MB por pessoa).
- Todo o resto do banco não pode ser lido pelo app: só por você, no painel.

Só na opção B: para **criar** o documento é preciso mandar o código de convite certo (o item `convite`, do próximo passo). Quem não tem o código consegue, no máximo, criar um usuário no Authentication, mas não consegue guardar nada. O próprio `convite` também não pode ser lido pelo app.

## Passo 5 - Definir o código de convite (só na opção B)

Se você escolheu a opção A (cadastro aberto), pule este passo.

1. Na aba **Dados** do Realtime Database, passe o mouse sobre a primeira linha (o endereço do banco) e clique no **+**.
2. Em **Nome**, digite `convite`. Em **Valor**, digite o código que você escolheu. Clique em **Adicionar**.

Dicas:

- Escolha um código que não seja fácil de adivinhar (por exemplo `cafe-com-bolo-2026`). Maiúsculas e minúsculas fazem diferença. Não use o código do emulador (`FAMILIA2026`).
- Quem tem o código pode criar conta, então passe-o só para quem você quer convidar.
- Para **trocar** o código, edite o valor no mesmo lugar (vale só para quem criar conta depois). Para **fechar** os cadastros, apague o item `convite`. Quem já tem conta continua entrando normalmente.

## Passo 6 - Copiar duas informações para o app

1. No Firebase, clique na engrenagem ao lado de **Visão geral do projeto** > **Configurações do projeto** (Project settings). Na aba **Geral**, em **Seus aplicativos** (Your apps), clique no ícone **</>** (Web), dê um apelido (por exemplo `pauta`), **não** marque o Firebase Hosting e clique em **Registrar app**. Aparece um bloco `firebaseConfig` com `apiKey: "AIza..."`. Copie esse valor. (Ele também fica em Configurações do projeto > Geral, como **Chave de API da Web**.)
2. Abra o arquivo `js/cloud/config.js` e preencha os dois primeiros campos:

   ```js
   export const CLOUD = {
     apiKey: 'AIza...cole-aqui-a-sua-chave',
     databaseUrl: 'https://pauta-familia-default-rtdb.firebaseio.com',
     exigirLogin: true,
     exigirConvite: false, // false com a opção A do passo 4; true com a opção B
     // não mexa nas duas linhas seguintes
     ...
   ```

   O endereço do banco é o do passo 3, sem a barra no final.
3. Escolha como a conta funciona no seu site:
   - `exigirLogin: true` (o padrão): o app **só abre para quem entrou numa conta**. A tela de entrada vem antes de tudo e não dá para pular; as tarefas só aparecem depois do login. Quem já entrou continua usando normalmente, inclusive sem internet.
   - `exigirLogin: false`: a conta é **opcional**. Quem não entra usa o app só naquele aparelho, e o menu lateral mostra **Entrar ou criar conta**.

   Isso é uma regra do próprio app, não uma proteção contra quem baixar o código (essa pessoa pode desligá-la no computador dela). O que protege os dados na nuvem é o login e as regras do banco (e, na opção B, o código de convite).

## Passo 7 - Testar no seu computador

1. Abra o site localmente (veja "Desenvolvimento" no [README](../README.md): `servir.ps1` e `http://localhost:8789/`).
2. Com `exigirLogin: true`, o app abre direto na tela de entrada (com `false`, o menu lateral mostra **Entrar ou criar conta**). Toque em **Criar conta** e crie uma conta com e-mail e senha (pelo menos 8 caracteres) e, na opção B, o código de convite.
3. Adicione uma tarefa. Em instantes, no Firebase (Realtime Database > Dados), aparece `users/<id>` com os campos `blob`, `sig`, `updatedAt` e `v` (e `convite`, na opção B).
4. Abra o site em outro navegador (ou em uma janela anônima) e entre com o mesmo e-mail e senha: a tarefa aparece.
5. Só na opção B: teste um código de convite errado ao criar outra conta; o app deve recusar e **não** deixar a conta criada.
6. Teste **Esqueci minha senha**: o e-mail chega em português, com remetente `noreply@SEU-PROJETO.firebaseapp.com` (olhe também o spam).

## Passo 8 - Restringir a chave de API (recomendado)

Camada extra, para a chave do Firebase só funcionar no seu site:

1. Abra <https://console.cloud.google.com/apis/credentials> e escolha o seu projeto no topo.
2. Clique na chave **Browser key (auto created by Firebase)**.
3. Em **Restrições de aplicativos**, escolha **Sites** (HTTP referrers) e adicione `https://SEU-USUARIO.github.io/*` e, para testar no seu computador, `http://localhost:8789/*`.
4. Em **Restrições de API**, confira se a lista tem a **Identity Toolkit API** e a **Token Service API** e nada além de APIs do Firebase.
5. Salve. Leva alguns minutos para valer.

Se depois disso o app disser "A chave de API do Firebase não é aceita para este endereço", o endereço do site não está na lista do passo 3.

## Passo 9 - Publicar

Publique como no [README](../README.md#publicar-no-github-pages). Para cada pessoa que você quiser convidar, mande o endereço do site (e o código de convite, na opção B). Ela abre o site e, na tela de entrada, toca em **Criar conta** (com `exigirLogin: false`, é no menu lateral, em **Entrar ou criar conta**).

## Dia a dia

- **Convidar alguém**: envie o endereço do site (e o código, na opção B).
- **Remover alguém**: no Firebase, apague o usuário em Authentication > Usuários **e** o item dele em Realtime Database > Dados > `users`.
- **Trocar o código ou fechar os cadastros** (opção B): passo 5. Na opção A, para fechar os cadastros passe para a opção B (regras do passo 4 e `exigirConvite: true`) e não crie o item `convite`: ninguém novo consegue criar conta, e quem já tem conta continua entrando.

## Como a sincronização funciona

- Cada aparelho guarda tudo localmente, então o Pauta continua funcionando sem internet. Com a conta, o app envia as mudanças alguns segundos depois de você mexer e busca as novidades ao voltar para a aba, quando a internet volta e a cada 90 segundos com o app aberto. Para checar se algo mudou, ele consulta só uma assinatura minúscula; baixa tudo apenas quando houve mudança.
- Nada se perde: mudanças em tarefas diferentes se juntam. Se duas pessoas ou aparelhos mexerem na **mesma** tarefa, vale a alteração mais recente. Excluir em um aparelho exclui nos outros. Etiquetas com o mesmo nome viram uma só.
- **Sair deste aparelho** envia o que falta e remove as tarefas daquele aparelho (elas continuam na conta); assim ninguém que usar o aparelho depois vê as suas. **Excluir minha conta** pede a senha e apaga a conta e os dados da nuvem; as tarefas do aparelho ficam. Com `exigirLogin: true`, depois de sair, de excluir a conta ou de a sessão vencer (por exemplo, senha trocada em outro lugar) o app volta para a tela de entrada; as tarefas daquele aparelho só aparecem de novo depois de entrar, e entrar com **outra** conta nunca mistura os dados.
- Um aparelho que passe mais de 90 dias sem sincronizar pode "ressuscitar" tarefas que foram excluídas nesse meio-tempo (o registro de exclusões é limpo depois de 90 dias).

## Limites do plano gratuito

- O Realtime Database no plano Spark inclui 1 GB de dados e 10 GB de downloads por mês ([documentação do Firebase](https://firebase.google.com/docs/database/usage/billing)). Cem tarefas completas (com anotação e checklist) ocupam uns 55 KB; para um grupo de família e amigos o consumo fica muito abaixo desses limites.
- O app grava até cerca de 900 KB por pessoa (mais de 1.600 tarefas completas) e avisa se passar. Apagar concluídas antigas resolve.
- O limite de conexões simultâneas do plano não se aplica: o app usa pedidos comuns, que não contam como conexão.

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "O login por e-mail e senha não está ativado no Firebase" | Passo 2. |
| "A chave de API do Firebase não é aceita para este endereço" | Confira `apiKey` em `js/cloud/config.js` e a lista de sites do passo 8. |
| "Não encontrei o banco de dados" | `databaseUrl` errado. Copie de novo na aba Dados (o final muda conforme o local do banco). |
| "O servidor recusou o acesso (código de convite incorreto ou regras do banco)" (com `exigirConvite: true`) | Confira o item `convite` na raiz do banco (maiúsculas e minúsculas contam) e se as regras da opção B foram publicadas. |
| "O servidor recusou o acesso (confira as regras do banco)" ou "O servidor recusou guardar os seus dados (regras do banco)" (com `exigirConvite: false`) | As regras publicadas não são as da opção A. Cole de novo as regras do passo 4 que combinam com `exigirConvite` e publique. |
| "Código de convite incorreto" ao criar conta | O código digitado não confere com o item `convite` (opção B). |
| "Sem conexão com a internet" com a internet funcionando | Bloqueador de anúncios, firewall ou rede de empresa bloqueando `googleapis.com` ou `firebaseio.com`. |
| Não aparece a tela de entrada nem **Entrar ou criar conta** | `apiKey` ou `databaseUrl` vazios, ou o navegador está com a versão antiga: recarregue com `Ctrl` + `F5`. |
| O app abre sem pedir login | `exigirLogin` está `false` em `js/cloud/config.js`, ou a pessoa já entrou neste aparelho. |
| Ninguém consegue entrar e o app não abre | Com `exigirLogin: true` o app depende do login: confira a chave de API e a lista de sites do passo 8, e se o Firebase está no ar. Para liberar o uso sem conta enquanto resolve, troque `exigirLogin` para `false`. |
| O e-mail de redefinição de senha não chega | Olhe o spam. O remetente é `noreply@SEU-PROJETO.firebaseapp.com`. |
| "Há tarefas demais para sincronizar" | Apague tarefas concluídas antigas. |
| "Muitas tentativas" | Espere alguns minutos. |

## Desligar a nuvem

Esvazie `apiKey` e `databaseUrl` em `js/cloud/config.js` e publique de novo: as telas de conta somem e as tarefas continuam no aparelho. Para manter a nuvem mas deixar a conta opcional, basta trocar `exigirLogin` para `false`. Para apagar tudo que está na nuvem, exclua o projeto no Firebase (Configurações do projeto > Excluir projeto).

## Testar sem criar nada no Firebase (emulador)

Para experimentar o login e a sincronização no seu computador, sem conta no Firebase:

```bash
python scripts/emulador-nuvem.py
```

Abra `http://127.0.0.1:8790/` (aparelho 1) e `http://localhost:8790/` (aparelho 2): endereços diferentes têm armazenamento separado no navegador, então funcionam como dois aparelhos. O código de convite do emulador é `FAMILIA2026`. Tudo fica na memória e some ao fechar. Opções: `--porta`, `--convite`, `--sem-convite` (cadastro aberto, sem código), `--ttl` (validade do token, em segundos), `--recente` (por quanto tempo um login conta como recente para excluir a conta) e `--login-opcional` (o emulador exige login, como o site publicado; com essa opção a conta é opcional).

O emulador e os testes automáticos seguem a documentação do Firebase, mas **não são o Firebase de verdade**: faça o passo 7 com o seu projeto antes de convidar alguém.
