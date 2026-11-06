// Aplica o tema salvo ANTES da página aparecer (evita o "piscar" claro/escuro).
(function () {
  try {
    var t = localStorage.getItem('pauta:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* sem armazenamento: usa o tema do sistema */ }
})();
