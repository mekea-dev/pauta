// Confere o "pacote" do site: o que o GitHub Pages vai servir e o que o modo offline precisa guardar.
// Roda no Node (GitHub Actions) e no navegador (tests/index.html).
import test from 'node:test';
import assert from 'node:assert/strict';

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const rootUrl = (rel) => new URL(`../${rel}`, import.meta.url);

async function readText(rel) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return readFile(rootUrl(rel), 'utf8');
  }
  const res = await fetch(rootUrl(rel));
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  return res.text();
}

async function exists(rel) {
  if (isNode) {
    const { access } = await import('node:fs/promises');
    return access(rootUrl(rel)).then(() => true, () => false);
  }
  return (await fetch(rootUrl(rel))).ok;
}

async function swAssets() {
  const sw = await readText('sw.js');
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(m, 'a lista ASSETS não foi encontrada em sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('sw.js: a versão é a mesma de js/config.js', async () => {
  const sw = await readText('sw.js');
  const cfg = await readText('js/config.js');
  const a = /const VERSION = '([^']+)'/.exec(sw)?.[1];
  const b = /APP_VERSION = '([^']+)'/.exec(cfg)?.[1];
  assert.ok(a && b, 'versão não encontrada');
  assert.equal(a, b);
});

test('sw.js: todo arquivo da lista offline existe (senão o cache falha)', async () => {
  const assets = await swAssets();
  assert.ok(assets.length > 25);
  const faltando = [];
  for (const a of assets) {
    if (a === './') continue;
    if (!(await exists(a.replace(/^\.\//, '')))) faltando.push(a);
  }
  assert.deepEqual(faltando, []);
});

test('sw.js: lista todos os arquivos de js/, css/ e icons/ (só no Node, que enxerga as pastas)', async () => {
  if (!isNode) return;
  const { readdir } = await import('node:fs/promises');
  const found = [];
  async function walk(dir) {
    for (const e of await readdir(rootUrl(dir), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}${e.name}/`);
      else found.push(`./${dir}${e.name}`);
    }
  }
  for (const d of ['js/', 'css/', 'icons/']) await walk(d);
  const listed = new Set(await swAssets());
  assert.deepEqual(found.filter((f) => !listed.has(f)), []);
});

test('index.html: caminhos relativos (o site roda em usuario.github.io/pauta/, não na raiz)', async () => {
  const html = await readText('index.html');
  assert.ok(!/\s(?:href|src)="\/(?!\/)/.test(html), 'há href/src começando com "/"');
  assert.ok(/<html lang="pt-BR">/.test(html));
  const manifest = JSON.parse(await readText('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) assert.ok(!icon.src.startsWith('/'), icon.src);
});

test('manifest: ícones existem e há 192, 512 e maskable (exigência para instalar)', async () => {
  const manifest = JSON.parse(await readText('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(await exists(icon.src), `${icon.src} não existe`);
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('JavaScript e CSS não usam caminhos absolutos', async () => {
  const files = (await swAssets()).filter((a) => a.endsWith('.js') || a.endsWith('.css'));
  for (const f of files) {
    const text = await readText(f.replace(/^\.\//, ''));
    assert.ok(!/from\s+['"]\//.test(text), `${f}: import absoluto`);
    assert.ok(!/url\(\s*['"]?\//.test(text), `${f}: url() absoluta`);
  }
});

test('sem emojis nem símbolos pictográficos (setas, marcas, bolinhas): use os ícones SVG', async () => {
  const pictografico = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const arquivos = new Set(['index.html', 'README.md', 'docs/NUVEM.md', 'docs/LEMBRETES.md', ...(await swAssets()).filter((a) => /\.(js|css)$/.test(a)).map((a) => a.replace(/^\.\//, ''))]);
  const achados = [];
  for (const f of arquivos) {
    const m = pictografico.exec(await readText(f));
    if (m) achados.push(`${f}: U+${m[0].codePointAt(0).toString(16).toUpperCase()}`);
  }
  assert.deepEqual(achados, []);
});

for (const [arquivo, rotulo] of [['regras-banco.json', 'com código de convite'], ['regras-banco-aberto.json', 'cadastro aberto']]) {
  test(`regras do banco (${rotulo}): o guia (docs/NUVEM.md) traz exatamente as regras de docs/${arquivo}`, async () => {
    const regras = JSON.parse(await readText(`docs/${arquivo}`));
    const guia = await readText('docs/NUVEM.md');
    const blocos = [...guia.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
    assert.ok(blocos.some((b) => JSON.stringify(b) === JSON.stringify(regras)), 'o guia não traz as regras do arquivo');
  });
}

test('regras do banco (cadastro aberto): só o dono acessa o próprio nó, criar não exige código e os campos são fechados', async () => {
  const { rules } = JSON.parse(await readText('docs/regras-banco-aberto.json'));
  const uid = rules.users.$uid;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.equal(uid['.read'], 'auth != null && auth.uid === $uid');
  assert.equal(uid['.write'], 'auth != null && auth.uid === $uid', 'só o dono grava, e sem exigir código');
  assert.match(uid['.validate'], /hasChildren\(\['v', 'updatedAt', 'sig', 'blob'\]\)/);
  for (const campo of ['v', 'updatedAt', 'sig', 'blob']) assert.ok(uid[campo]?.['.validate'], `sem validação para ${campo}`);
  assert.equal(uid.convite, undefined, 'no cadastro aberto o app não manda o campo convite');
  assert.equal(uid.$outro['.validate'], false);
  assert.match(uid.blob['.validate'], /<= 1000000/);
});

test('regras do banco (com código de convite): só o dono acessa o próprio nó, criar exige o código e os campos são fechados', async () => {
  const { rules } = JSON.parse(await readText('docs/regras-banco.json'));
  const uid = rules.users.$uid;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.match(uid['.read'], /auth != null && auth\.uid === \$uid/);
  assert.match(uid['.write'], /auth != null && auth\.uid === \$uid/);
  // criar o nó exige o código, comparado com o item "convite" da raiz, e nunca vale "nada == nada"
  assert.match(uid['.write'], /data\.exists\(\)/);
  assert.match(uid['.write'], /newData\.child\('convite'\)\.isString\(\)/);
  assert.match(uid['.write'], /root\.child\('convite'\)\.val\(\)/);
  // os campos que o app grava (js/cloud/sync.js) e os limites que ele respeita
  for (const campo of ['v', 'updatedAt', 'sig', 'blob', 'convite']) assert.ok(uid[campo]?.['.validate'], `sem validação para ${campo}`);
  assert.match(uid['.validate'], /hasChildren\(\['v', 'updatedAt', 'sig', 'blob'\]\)/);
  assert.equal(uid.$outro['.validate'], false);
  assert.match(uid.blob['.validate'], /<= 1000000/);
  const sync = await readText('js/cloud/sync.js');
  const max = Number(/const MAX_BLOB = (\d+)/.exec(sync)?.[1]);
  assert.ok(max > 0 && max < 1000000, 'MAX_BLOB do app precisa caber no limite das regras');
});

test('o emulador entrega todas as opções de js/cloud/config.js (senão o app testado nele se comporta diferente do site)', async () => {
  const config = await readText('js/cloud/config.js');
  const emulador = await readText('scripts/emulador-nuvem.py');
  const chaves = [...config.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  for (const esperada of ['apiKey', 'databaseUrl', 'exigirLogin', 'exigirConvite', 'identityUrl', 'tokenUrl']) {
    assert.ok(chaves.includes(esperada), `config.js não tem ${esperada} (leu: ${chaves.join(', ')})`);
  }
  const faltando = chaves.filter((k) => !new RegExp(`^ {2}${k}:`, 'm').test(emulador));
  assert.deepEqual(faltando, [], 'opções que o emulador não entrega');
});

test('lembretes: o endereço do serviço (js/push-config.js) está liberado na política de conteúdo e é https', async () => {
  const url = /workerUrl:\s*'([^']*)'/.exec(await readText('js/push-config.js'))?.[1];
  assert.notEqual(url, undefined, 'workerUrl não encontrado em js/push-config.js');
  if (!url) return; // vazio = sem avisos com o app fechado
  assert.ok(url.startsWith('https://'), 'o serviço precisa ser https');
  const html = await readText('index.html');
  const connect = /connect-src([^;"]*)/.exec(html)?.[1] ?? '';
  assert.ok(connect.split(/\s+/).includes(new URL(url).origin), `connect-src do index.html não libera ${new URL(url).origin}`);
});

test('segurança: política de conteúdo no HTML, sem script ou estilo embutido', async () => {
  const html = await readText('index.html');
  assert.ok(/Content-Security-Policy/.test(html));
  assert.ok(/script-src 'self'/.test(html));
  assert.ok(!/script-src[^"]*unsafe-inline/.test(html));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'há <script> embutido');
  assert.ok(!/<style[\s>]/.test(html), 'há <style> embutido');
  // innerHTML só é aceito no arquivo dos ícones (textos fixos); o resto monta a tela com textContent
  for (const f of (await swAssets()).filter((a) => a.startsWith('./js/'))) {
    if (f === './js/ui/icons.js') continue;
    const text = await readText(f.replace(/^\.\//, ''));
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text), `${f}: usa HTML dinâmico`);
  }
});
