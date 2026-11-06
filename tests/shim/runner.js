// Executor de testes para o NAVEGADOR (a máquina de desenvolvimento não tem Node).
// Os arquivos *.test.js usam `import test from 'node:test'`; em tests/index.html um import map
// aponta esse nome para este arquivo. No GitHub Actions roda o `node --test` de verdade.
const queue = [];

export default function test(name, fn) {
  queue.push({ name, fn });
}
test.skip = (name) => {
  queue.push({ name, skip: true });
};
export { test };

export async function run(listEl, summaryEl) {
  let passed = 0;
  let failed = 0;
  const failures = [];
  for (const t of queue) {
    const li = document.createElement('li');
    if (t.skip) {
      li.textContent = `– ${t.name} (ignorado)`;
      listEl.append(li);
      continue;
    }
    try {
      await t.fn();
      passed++;
      li.className = 'ok';
      li.textContent = `OK     ${t.name}`;
    } catch (e) {
      failed++;
      const message = String(e?.message ?? e);
      failures.push({ name: t.name, message });
      li.className = 'fail';
      li.textContent = `FALHA  ${t.name} - ${message}`;
    }
    listEl.append(li);
  }
  summaryEl.textContent = `${passed} passaram, ${failed} falharam (${queue.length} testes)`;
  summaryEl.className = failed ? 'fail' : 'ok';
  document.title = `${failed ? 'FALHOU' : 'OK'} — ${passed}/${queue.length} testes`;
  window.__testResults = { passed, failed, total: queue.length, failures };
}
