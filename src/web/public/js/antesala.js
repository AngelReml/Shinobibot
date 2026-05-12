// antesala.js — Bloque 8.3 (simplificado)
//
// Pantalla negra con el shinobi-mark en blanco — fade in 1.2s, hold 1.5s,
// fade out 0.8s. Después chat emerge con fade in 0.6s. Total: 4.1s.
//
// Si sessionStorage.shinobiEntered === 'true' la antesala se salta
// inmediatamente (visita posterior dentro de la misma sesión).

(function () {
  'use strict';

  const antesala = document.getElementById('antesala');
  if (!antesala) return;

  function revealChat() {
    const chat = document.getElementById('chat-app');
    if (chat) {
      chat.style.opacity = '1';
      chat.style.pointerEvents = 'auto';
    }
  }

  // ─── Skip si ya entramos en esta sesión ──────────────────────────────
  if (sessionStorage.getItem('shinobiEntered') === 'true') {
    antesala.classList.add('hidden');
    revealChat();
    return;
  }

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    antesala.classList.add('hidden');
    sessionStorage.setItem('shinobiEntered', 'true');
    document.dispatchEvent(new CustomEvent('antesala-done'));
  }

  // ─── Secuencia automática ────────────────────────────────────────────
  // El @keyframes del CSS controla el fade del mark (3.5s total).
  // A los 3.5s disolvemos el contenedor negro y revelamos el chat.
  setTimeout(() => {
    antesala.classList.add('dissolving');
    revealChat();
  }, 3500);
  setTimeout(finish, 4100); // +600ms para que el dissolve termine

  // ─── Skip manual ─────────────────────────────────────────────────────
  function skip() {
    antesala.classList.add('dissolving');
    revealChat();
    setTimeout(finish, 350);
  }
  const skipBtn = document.getElementById('antesala-skip');
  if (skipBtn) skipBtn.addEventListener('click', (ev) => { ev.stopPropagation(); skip(); });
  antesala.addEventListener('click', skip);
  window.addEventListener('keydown', (ev) => {
    if (done) return;
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') skip();
  }, { once: false });
})();
