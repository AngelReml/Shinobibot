// easter_eggs.js — mecánicas ocultas que convierten el chat en una sala.
//
// Nada de esto es visible hasta que el usuario lo descubre. Excepto el
// "?" minúsculo al final de la pista del input — único hilo que tira de
// toda la madeja.
//
// Mecánicas:
//   /zen                              → modo zen (oculta todo, Esc para salir)
//   ↑↑↓↓←→←→ba                        → modo sensei 30s (kanji lluvia + oro + hanko 師)
//   60s inactivo                      → horizon stroke + watermark se intensifica
//   3 líneas separadas por Shift+Enter → composer en Cormorant italic centrado (haiku)
//   7 clicks en el logo del sidebar   → shu-ha-ri (守/破/離) random toast
//   Ctrl+/                            → cheat sheet flotante (巻物)

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setupZenMode();
    setupKonami();
    setupInactivity();
    setupHaikuDetection();
    setupLogoEgg();
    setupCheatSheet();
  }

  // ════════════════════════════════════════════════════════════════════
  // /zen — interceptación a nivel document.capture para correr ANTES que app.js
  // ════════════════════════════════════════════════════════════════════
  function setupZenMode() {
    function tryHandle(e) {
      const composer = document.getElementById('composer');
      if (!composer) return false;
      if (composer.value.trim() !== '/zen') return false;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      toggleZen();
      composer.value = '';
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'composer') {
        tryHandle(e);
      }
    }, true);
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('#send-btn')) {
        tryHandle(e);
      }
    }, true);
    // Esc sale de zen
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('zen')) {
        document.body.classList.remove('zen');
        showEggToast('解', 'Modo zen desactivado.');
      }
    });
  }
  function toggleZen() {
    const on = !document.body.classList.contains('zen');
    document.body.classList.toggle('zen', on);
    showEggToast('禅', on ? 'Modo zen activado. Esc para salir.' : 'Modo zen desactivado.');
  }

  // ════════════════════════════════════════════════════════════════════
  // Konami → sensei mode
  // ════════════════════════════════════════════════════════════════════
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let kIdx = 0;
  function setupKonami() {
    document.addEventListener('keydown', (e) => {
      const expected = KONAMI[kIdx];
      const matches = (e.key === expected) || (e.key && e.key.toLowerCase() === expected.toLowerCase());
      if (matches) {
        kIdx++;
        if (kIdx === KONAMI.length) {
          kIdx = 0;
          enterSenseiMode();
        }
      } else {
        kIdx = (e.key === KONAMI[0]) ? 1 : 0;
      }
    });
  }

  let senseiActive = false;
  function enterSenseiMode() {
    if (senseiActive) return;
    senseiActive = true;
    document.body.classList.add('sensei');
    spawnKanjiRain();
    showEggToast('師', 'Modo sensei. 30 segundos. Que la tinta caiga.');
    setTimeout(() => {
      document.body.classList.remove('sensei');
      senseiActive = false;
    }, 30000);
  }

  const KANJI_POOL = ['忍','道','武','心','静','風','月','影','刀','流','守','破','離','義','礼','智','信','仁','勇','誠'];
  function spawnKanjiRain() {
    let container = document.getElementById('sensei-rain');
    if (container) container.remove();
    container = document.createElement('div');
    container.id = 'sensei-rain';
    document.body.appendChild(container);
    const count = 36;
    for (let i = 0; i < count; i++) {
      const ch = KANJI_POOL[Math.floor(Math.random() * KANJI_POOL.length)];
      const span = document.createElement('span');
      span.textContent = ch;
      span.className = 'sensei-kanji';
      span.style.left = (Math.random() * 100) + '%';
      span.style.animationDuration = (8 + Math.random() * 8) + 's';
      span.style.animationDelay = (Math.random() * 7) + 's';
      span.style.fontSize = (28 + Math.random() * 60) + 'px';
      span.style.opacity = String(0.22 + Math.random() * 0.55);
      container.appendChild(span);
    }
    setTimeout(() => { if (container && container.parentNode) container.remove(); }, 32000);
  }

  // ════════════════════════════════════════════════════════════════════
  // Inactividad → dojo-quiet
  // ════════════════════════════════════════════════════════════════════
  function setupInactivity() {
    let idleTimer = null;
    const TRIGGER_MS = 60000;
    function reset() {
      clearTimeout(idleTimer);
      if (document.body.classList.contains('dojo-quiet')) {
        document.body.classList.remove('dojo-quiet');
      }
      idleTimer = setTimeout(() => {
        if (!document.body.classList.contains('zen')) {
          document.body.classList.add('dojo-quiet');
        }
      }, TRIGGER_MS);
    }
    ['mousemove','keydown','click','scroll','wheel','touchstart'].forEach(ev =>
      document.addEventListener(ev, reset, { passive: true })
    );
    reset();
  }

  // ════════════════════════════════════════════════════════════════════
  // Haiku detection — 3 líneas no vacías = composer en estilo haiku
  // ════════════════════════════════════════════════════════════════════
  function setupHaikuDetection() {
    const composer = document.getElementById('composer');
    if (!composer) return;
    composer.addEventListener('input', () => {
      const lines = composer.value.split('\n');
      const isHaiku = lines.length === 3 && lines.every(l => l.trim().length > 0);
      composer.classList.toggle('haiku-mode', isHaiku);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 7 clicks en logo → shu-ha-ri
  // ════════════════════════════════════════════════════════════════════
  function setupLogoEgg() {
    const logo = document.querySelector('.brand-shinobi-img');
    if (!logo) return;
    let clicks = 0;
    let timer = null;
    const PRINCIPLES = [
      { kanji: '守', name: 'Shu',  desc: 'Mantén la forma. Sigue al maestro hasta absorberlo.' },
      { kanji: '破', name: 'Ha',   desc: 'Rompe la forma. Encuentra tus propios límites.' },
      { kanji: '離', name: 'Ri',   desc: 'Separa la forma. Trasciende. La técnica desaparece.' },
    ];
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => { clicks = 0; }, 1500);
      if (clicks === 7) {
        clicks = 0;
        const p = PRINCIPLES[Math.floor(Math.random() * PRINCIPLES.length)];
        showEggToast(p.kanji, `${p.name} — ${p.desc}`);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Cheat sheet (Ctrl+/)
  // ════════════════════════════════════════════════════════════════════
  function setupCheatSheet() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        toggleCheatSheet();
      }
    });
    // Hilo minúsculo al final del hint del input — el único indicio visible.
    const hint = document.getElementById('input-hint');
    if (hint && !document.getElementById('cheat-trigger')) {
      const dot = document.createElement('span');
      dot.id = 'cheat-trigger';
      dot.textContent = '  ·  ?';
      dot.title = 'Atajos (Ctrl+/)';
      dot.addEventListener('click', toggleCheatSheet);
      hint.appendChild(dot);
    }
  }

  function toggleCheatSheet() {
    const existing = document.getElementById('cheat-modal');
    if (existing) { closeCheatSheet(existing); return; }
    const modal = document.createElement('div');
    modal.id = 'cheat-modal';
    modal.innerHTML = `
      <div class="cheat-paper">
        <div class="cheat-title">巻物 · Atajos del dojo</div>
        <table class="cheat-table">
          <tbody>
            <tr><td><kbd>Enter</kbd></td><td>enviar</td></tr>
            <tr><td><kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>nueva línea</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>.</kbd></td><td>modo concentración</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>buscar conversaciones</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>esta hoja</td></tr>
            <tr><td><code>/zen</code></td><td>modo zen — <kbd>Esc</kbd> para salir</td></tr>
            <tr><td>doble-clic título</td><td>renombrar conversación</td></tr>
            <tr><td class="cheat-spacer" colspan="2">— y algunas cosas que vale más descubrir —</td></tr>
          </tbody>
        </table>
        <div class="cheat-close-hint">clic fuera · Esc para cerrar</div>
      </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    const closer = (ev) => {
      if (ev.type === 'click' && ev.target !== modal) return;
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      closeCheatSheet(modal);
      document.removeEventListener('keydown', closer);
      modal.removeEventListener('click', closer);
    };
    document.addEventListener('keydown', closer);
    modal.addEventListener('click', closer);
  }
  function closeCheatSheet(modal) {
    modal.classList.remove('open');
    setTimeout(() => { if (modal.parentNode) modal.remove(); }, 300);
  }

  // ════════════════════════════════════════════════════════════════════
  // Egg toast — inscripción centrada, distinta del toast normal
  // ════════════════════════════════════════════════════════════════════
  function showEggToast(kanji, text) {
    let stack = document.getElementById('egg-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'egg-toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'egg-toast';
    el.innerHTML = `<div class="egg-kanji"></div><div class="egg-text"></div>`;
    el.querySelector('.egg-kanji').textContent = kanji;
    el.querySelector('.egg-text').textContent = text;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { if (el.parentNode) el.remove(); }, 600);
    }, 4500);
  }

  // Expose para que app.js consulte el kanji activo del hanko (sensei mode).
  window.ShinobiEggs = {
    currentHankoKanji() { return senseiActive ? '師' : '忍'; },
  };
})();
