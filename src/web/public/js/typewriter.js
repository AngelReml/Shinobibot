// typewriter.js — Bloque 8.5
//
// Revela texto HTML carácter a carácter sin destruir su estructura.
// Walka el DOM, envuelve cada char de cada text-node en <span class="tw-char">,
// y los enciende con un bucle requestAnimationFrame DETERMINISTA.
//
// Por qué rAF y no animation-delay por CSS: con cientos de animaciones
// escalonadas Chrome puede saltarse ventanas de delay enteras (observado
// en real: chars con delay 1–4s nunca aplicaban su fill). El bucle rAF
// enciende cada char cuando le toca por reloj — inmune a ese quirk, y
// además es el canon (Tabla 13): lineal, sin fade por carácter. La tinta
// toca el papel en seco.
//
// Los <pre> se tratan como bloque atómico — el código se lee íntegro.
//
// API: window.Typewriter.reveal(rootEl, opts?) → totalDurationMs
//   opts.charDuration  — ms por carácter base (default 22)
//   opts.maxTotal      — tope total ms (default 4500)
//   opts.blockCost     — "coste en chars" de cada bloque <pre> (default 12)

(function () {
  'use strict';

  function reveal(root, opts) {
    if (!root) return 0;
    opts = opts || {};
    const charDur = opts.charDuration || 22;
    const maxTotal = opts.maxTotal || 4500;
    const blockCost = opts.blockCost || 12;

    // Eventos en orden DOM: cada char o cada bloque atómico.
    const events = [];

    function walk(node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent;
          if (!text) continue;
          const frag = document.createDocumentFragment();
          for (const ch of text) {
            const span = document.createElement('span');
            span.className = 'tw-char';
            span.textContent = ch;
            frag.appendChild(span);
            events.push({ type: 'char', el: span });
          }
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (tag === 'PRE') {
            // Bloque atómico: no recursamos. El bloque entra entero.
            child.classList.add('tw-block');
            events.push({ type: 'block', el: child });
          } else {
            walk(child);
          }
        }
      }
    }
    walk(root);

    if (events.length === 0) return 0;

    // Unidades de tiempo total: cada char = 1, cada bloque = blockCost.
    let units = 0;
    for (const ev of events) units += ev.type === 'block' ? blockCost : 1;

    const naive = units * charDur;
    const targetTotal = Math.min(naive, maxTotal);
    const stride = units > 0 ? targetTotal / units : 0;

    // Momento de encendido de cada evento (ms desde el inicio).
    let cursorUnits = 0;
    for (const ev of events) {
      ev.at = cursorUnits * stride;
      cursorUnits += ev.type === 'block' ? blockCost : 1;
    }

    // Bucle de inscripción: enciende todo lo que ya tocó por reloj.
    const t0 = performance.now();
    let next = 0;
    function tick(now) {
      const elapsed = now - t0;
      while (next < events.length && events[next].at <= elapsed) {
        events[next].el.classList.add('on');
        next++;
      }
      if (next < events.length) {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);

    // Red de seguridad: pase lo que pase (pestaña en background, GC,
    // throttling), a targetTotal+100ms TODO queda visible.
    setTimeout(() => {
      for (const ev of events) ev.el.classList.add('on');
    }, targetTotal + 100);

    return targetTotal;
  }

  window.Typewriter = { reveal };
})();
