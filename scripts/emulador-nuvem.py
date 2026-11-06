#!/usr/bin/env python3
"""Emulador local da nuvem do Pauta (para testar login e sincronização SEM criar nada no Firebase).

Serve o site e imita, em memória, o que o app usa do Firebase: cadastro e login por e-mail/senha,
tokens que vencem, e o Realtime Database com as mesmas regras do guia (so o dono le/grava o proprio no;
criar o no exige o codigo de convite). Nada sai da sua maquina e tudo some ao fechar.

Uso:
    python scripts/emulador-nuvem.py                  # http://127.0.0.1:8790/
    python scripts/emulador-nuvem.py --ttl 90         # token vale 90 s (testa a renovacao automatica)
    python scripts/emulador-nuvem.py --recente 20     # login "recente" vale 20 s (testa a exclusao da conta)
    python scripts/emulador-nuvem.py --login-opcional # o app abre sem exigir conta (o padrao exige, como o site publicado)

Para simular DOIS aparelhos use dois enderecos: http://localhost:8790/ e http://127.0.0.1:8790/
(enderecos diferentes = armazenamento do navegador separado). Codigo de convite padrao: FAMILIA2026.
Endpoints de ajuda: /__emulador/estado  /__emulador/emails  (POST) /__emulador/reset
"""
import argparse
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}
# o emulador entrega esta configuracao no lugar de js/cloud/config.js (os enderecos sao do proprio emulador)
CONFIG_JS = """export const CLOUD = {
  apiKey: 'emulador',
  databaseUrl: '/__emulador/db',
  exigirLogin: __EXIGIR_LOGIN__,
  exigirConvite: true,
  identityUrl: '/__emulador/identity/v1',
  tokenUrl: '/__emulador/token/v1',
};
export const cloudEnabled = () => Boolean(CLOUD.apiKey && CLOUD.databaseUrl);
"""


class Estado:
    def __init__(self, convite, ttl, recente=300):
        self.convite = convite
        self.ttl = ttl
        self.recente = recente  # o Firebase so exclui a conta de quem digitou a senha ha pouco tempo
        self.reset()

    def reset(self):
        self.users = {}  # e-mail (minusculo) -> {uid, password, email}
        self.tokens = {}  # idToken -> (uid, expira_em, quando_digitou_a_senha)
        self.refresh = {}  # refreshToken -> (uid, quando_digitou_a_senha)
        self.dados = {}  # caminho -> valor (JSON)
        self.emails = []  # e-mails de redefinicao "enviados"
        self.n = 0


ESTADO = None
LOGIN_OPCIONAL = False  # --login-opcional: o app abre sem exigir conta (como com exigirLogin: false)
LOCK = threading.Lock()


def documento_valido(v):
    """Espelho do ".validate" de docs/regras-banco.json: so os campos conhecidos, com os tipos e tamanhos certos."""
    if not isinstance(v, dict) or any(k not in ('v', 'updatedAt', 'sig', 'blob', 'convite') for k in v):
        return False

    def texto(k, maximo):
        return isinstance(v.get(k), str) and len(v[k]) <= maximo

    return (isinstance(v.get('v'), (int, float)) and not isinstance(v.get('v'), bool)
            and texto('updatedAt', 40) and texto('sig', 100) and texto('blob', 1_000_000)
            and ('convite' not in v or texto('convite', 100)))


class Handler(BaseHTTPRequestHandler):
    server_version = 'EmuladorPauta/1.0'

    # ---------- utilidades ----------
    def log_message(self, fmt, *args):  # so as chamadas da API (o resto e barulho)
        if '/__emulador/' in (self.path or ''):
            print(f'  {self.command:6} {self.path.split("?")[0]}  ->  {args[1] if len(args) > 1 else ""}')

    def corpo(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n).decode('utf-8') if n else ''

    def enviar(self, status, dados, tipo):
        self.send_response(status)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(dados)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(dados)

    def json(self, status, valor):
        self.enviar(status, json.dumps(valor, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def erro(self, mensagem, status=400):
        self.json(status, {'error': {'code': status, 'message': mensagem}})

    def emitir_token(self, uid, email):
        ESTADO.n += 1
        id_token = f'id.{secrets.token_urlsafe(18)}'
        refresh = f'rt.{secrets.token_urlsafe(18)}'
        agora = time.time()  # renovar o token depois NAO muda a hora em que a senha foi digitada
        ESTADO.tokens[id_token] = (uid, agora + ESTADO.ttl, agora)
        ESTADO.refresh[refresh] = (uid, agora)
        return {'idToken': id_token, 'refreshToken': refresh, 'expiresIn': str(ESTADO.ttl), 'localId': uid, 'email': email}

    # ---------- login (Identity Toolkit) ----------
    def identidade(self, operacao, q):
        if q.get('key', [''])[0] != 'emulador':
            return self.erro('API key not valid. Please pass a valid API key.')
        try:
            corpo = json.loads(self.corpo() or '{}')
        except ValueError:
            return self.erro('INVALID_JSON_PAYLOAD')
        email = (corpo.get('email') or '').strip()
        with LOCK:
            if operacao == 'signUp':
                if '@' not in email or '.' not in email.split('@')[-1]:
                    return self.erro('INVALID_EMAIL')
                if email.lower() in ESTADO.users:
                    return self.erro('EMAIL_EXISTS')
                if len(corpo.get('password') or '') < 6:
                    return self.erro('WEAK_PASSWORD : Password should be at least 6 characters')
                uid = f'uid-{len(ESTADO.users) + 1}-{secrets.token_hex(3)}'
                ESTADO.users[email.lower()] = {'uid': uid, 'password': corpo['password'], 'email': email}
                return self.json(200, self.emitir_token(uid, email))
            if operacao == 'signInWithPassword':
                u = ESTADO.users.get(email.lower())
                if not u or u['password'] != corpo.get('password'):
                    return self.erro('INVALID_LOGIN_CREDENTIALS')
                return self.json(200, {**self.emitir_token(u['uid'], u['email']), 'registered': True})
            if operacao == 'sendOobCode':
                ESTADO.emails.append({'para': email, 'tipo': corpo.get('requestType'), 'idioma': self.headers.get('X-Firebase-Locale')})
                return self.json(200, {'email': email})
            if operacao == 'delete':
                t = ESTADO.tokens.get(corpo.get('idToken'))
                if not t:
                    return self.erro('INVALID_ID_TOKEN')
                if time.time() - t[2] > ESTADO.recente:
                    return self.erro('CREDENTIAL_TOO_OLD_LOGIN_AGAIN')
                for chave, u in list(ESTADO.users.items()):
                    if u['uid'] == t[0]:
                        del ESTADO.users[chave]
                return self.json(200, {})
        return self.erro('OPERATION_NOT_ALLOWED')

    def renovar(self, q):
        form = parse_qs(self.corpo())
        with LOCK:
            entrada = ESTADO.refresh.get((form.get('refresh_token') or [''])[0])
            if (form.get('grant_type') or [''])[0] != 'refresh_token' or not entrada:
                return self.erro('INVALID_REFRESH_TOKEN')
            uid, quando_digitou = entrada
            if not any(u['uid'] == uid for u in ESTADO.users.values()):
                return self.erro('USER_NOT_FOUND')
            id_token = f'id.{secrets.token_urlsafe(18)}'
            ESTADO.tokens[id_token] = (uid, time.time() + ESTADO.ttl, quando_digitou)
            return self.json(200, {'id_token': id_token, 'refresh_token': form['refresh_token'][0], 'expires_in': str(ESTADO.ttl),
                                   'user_id': uid, 'token_type': 'Bearer', 'project_id': 'emulador'})

    # ---------- banco (Realtime Database) ----------
    def banco(self, metodo, caminho, q):
        with LOCK:
            token = ESTADO.tokens.get((q.get('auth') or [''])[0])
            if not token or token[1] <= time.time():
                return self.json(401, {'error': 'Auth token is expired'})
            partes = caminho.split('/')
            if partes[0] != 'users' or len(partes) > 3 or partes[1] != token[0]:
                return self.json(401, {'error': 'Permission denied'})  # regra: so o dono (e os filhos do no dele)
            if metodo == 'GET':
                doc = ESTADO.dados.get('users/' + partes[1])
                if len(partes) == 3:
                    return self.json(200, doc.get(partes[2]) if isinstance(doc, dict) else None)
                return self.json(200, doc)
            if len(partes) != 2:
                return self.json(401, {'error': 'Permission denied'})
            if metodo == 'PUT':
                try:
                    valor = json.loads(self.corpo())
                except ValueError:
                    return self.json(400, {'error': 'Invalid data; couldn\'t parse JSON object'})
                convite = valor.get('convite') if isinstance(valor, dict) else None
                if caminho not in ESTADO.dados and not (isinstance(convite, str) and convite == ESTADO.convite):
                    return self.json(401, {'error': 'Permission denied'})  # regra: criar exige o convite
                if not documento_valido(valor):
                    return self.json(401, {'error': 'Permission denied'})  # regra ".validate" (docs/regras-banco.json)
                ESTADO.dados[caminho] = valor
                return self.json(200, valor)
            if metodo == 'DELETE':
                ESTADO.dados.pop(caminho, None)
                return self.json(200, None)
        return self.json(405, {'error': 'Method not allowed'})

    # ---------- arquivos do site ----------
    def estatico(self, caminho):
        rel = caminho.lstrip('/') or 'index.html'
        arquivo = os.path.abspath(os.path.join(ROOT, rel))
        if not (arquivo + os.sep).startswith(ROOT + os.sep):
            return self.enviar(403, b'Proibido', 'text/plain; charset=utf-8')
        if os.path.isdir(arquivo):
            arquivo = os.path.join(arquivo, 'index.html')
        if not os.path.isfile(arquivo):
            return self.enviar(404, b'Nao encontrado', 'text/plain; charset=utf-8')
        with open(arquivo, 'rb') as f:
            dados = f.read()
        self.enviar(200, dados, MIME.get(os.path.splitext(arquivo)[1].lower(), 'application/octet-stream'))

    # ---------- roteamento ----------
    def rotear(self, metodo):
        url = urlparse(self.path)
        caminho = unquote(url.path)
        q = parse_qs(url.query)
        if caminho == '/js/cloud/config.js' and metodo in ('GET', 'HEAD'):
            config = CONFIG_JS.replace('__EXIGIR_LOGIN__', 'false' if LOGIN_OPCIONAL else 'true')
            return self.enviar(200, config.encode('utf-8'), MIME['.js'])
        if caminho.startswith('/__emulador/identity/v1/accounts:') and metodo == 'POST':
            return self.identidade(caminho.split(':', 1)[1], q)
        if caminho == '/__emulador/token/v1/token' and metodo == 'POST':
            return self.renovar(q)
        if caminho.startswith('/__emulador/db/') and caminho.endswith('.json'):
            return self.banco(metodo, caminho[len('/__emulador/db/'):-5], q)
        if caminho == '/__emulador/estado':
            return self.json(200, {'usuarios': [{'email': u['email'], 'uid': u['uid']} for u in ESTADO.users.values()],
                                   'caminhos': {c: len((v or {}).get('blob', '')) for c, v in ESTADO.dados.items()}})
        if caminho == '/__emulador/emails':
            return self.json(200, ESTADO.emails)
        if caminho == '/__emulador/reset' and metodo == 'POST':
            with LOCK:
                ESTADO.reset()
            return self.json(200, {'ok': True})
        if metodo in ('GET', 'HEAD'):
            return self.estatico(caminho)
        return self.json(404, {'error': 'not found'})

    def do_GET(self): self.rotear('GET')
    def do_HEAD(self): self.rotear('HEAD')
    def do_POST(self): self.rotear('POST')
    def do_PUT(self): self.rotear('PUT')
    def do_DELETE(self): self.rotear('DELETE')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()


def main():
    global ESTADO, LOGIN_OPCIONAL
    ap = argparse.ArgumentParser(description='Emulador local da nuvem do Pauta.')
    ap.add_argument('--porta', type=int, default=8790)
    ap.add_argument('--login-opcional', action='store_true', help='o app abre sem exigir conta (por padrao o emulador exige login, como o site publicado)')
    ap.add_argument('--convite', default='FAMILIA2026')
    ap.add_argument('--ttl', type=int, default=3600, help='validade do token, em segundos')
    ap.add_argument('--recente', type=int, default=300, help='por quantos segundos um login conta como recente (excluir a conta exige isso)')
    args = ap.parse_args()
    LOGIN_OPCIONAL = args.login_opcional
    ESTADO = Estado(args.convite, args.ttl, args.recente)
    servidor = ThreadingHTTPServer(('127.0.0.1', args.porta), Handler)
    print(f'Emulador do Pauta em http://127.0.0.1:{args.porta}/  (aparelho 2: http://localhost:{args.porta}/)')
    print(f'Codigo de convite: {args.convite} | token vale {args.ttl}s | Ctrl+C para parar')
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
