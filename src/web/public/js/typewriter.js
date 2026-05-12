// typewriter.js — Bloque 8.3+ (wow pack)
//
// Revela texto HTML carácter a carácter sin destruir su estructura.
// Walka el DOM, envuelve cada char de cada text-node en <span class="tw-char">,
// y asigna animation-delay escalonado. Los <pre> se tratan como bloque atómico
// (fade-in del bloque entero) — el código necesita ser legible íntegro.
//
// Total cap: maxTotal ms — para respuestas largas el ritmo se acelera sin
// perder la sensación de inscripción.
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
      // Recorrer los hijos directos en orden
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
            // Bloque atómico: no recursamos. Fade in del PRE entero.
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

    let cursorUnits = 0;
    for (const ev of events) {
      ev.el.style.animationDelay = `${cursorUnits * stride}ms`;
      cursorUnits += ev.type === 'block' ? blockCost : 1;
    }

    return targetTotal;
  }

  window.Typewriter = { reveal };
})();
