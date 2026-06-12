// dialog.js — Bloque 8.6
// Diálogos en la voz del dojo, para no usar nunca los prompt()/confirm()
// nativos del navegador (rompen la inmersión y no respetan la marca).
// Inspirado en styledConfirm/styledPrompt de Odysseus, traducido a tinta.
//
// API (promesas):
//   window.ShinobiDialog.confirm({ title, message, okText, cancelText, danger })
//        → Promise<boolean>
//   window.ShinobiDialog.prompt({ title, message, value, okText, cancelText })
//        → Promise<string|null>   (null = cancelado)

(function () {
  'use strict';

  let $modal, $title, $msg, $input, $ok, $cancel;
  let resolver = null;
  let mode = 'confirm';

  function grab() {
    $modal = document.getElementById('dialog-modal');
    $title = document.getElementById('dialog-title');
    $msg = document.getElementById('dialog-message');
    $input = document.getElementById('dialog-input');
    $ok = document.getElementById('dialog-ok');
    $cancel = document.getElementById('dialog-cancel');
    return !!$modal;
  }

  function close(result) {
    if (!$modal) return;
    $modal.hidden = true;
    $ok.classList.remove('accent');
    const r = resolver;
    resolver = null;
    if (r) r(result);
  }

  function open(opts, kind) {
    if (!$modal && !grab()) return Promise.resolve(kind === 'prompt' ? null : false);
    mode = kind;
    $title.textContent = opts.title || (kind === 'prompt' ? 'Shinobi pregunta' : 'Confirma');
    $msg.textContent = opts.message || '';
    $ok.textContent = opts.okText || (kind === 'prompt' ? 'Guardar' : 'Aceptar');
    $cancel.textContent = opts.cancelText || 'Cancelar';
    // El botón destructivo NO usa fondo bermellón: el bermellón es huella de
    // acción real, y borrar aquí es del operador (Tabla 8). Va en tinta fuerte.
    $ok.classList.toggle('danger-ink', !!opts.danger);
    if (kind === 'prompt') {
      $input.hidden = false;
      $input.value = opts.value != null ? String(opts.value) : '';
    } else {
      $input.hidden = true;
    }
    $modal.hidden = false;
    if (kind === 'prompt') setTimeout(() => { $input.focus(); $input.select(); }, 40);
    else setTimeout(() => $ok.focus(), 40);
    return new Promise((resolve) => { resolver = resolve; });
  }

  function confirm(opts) { return open(opts || {}, 'confirm'); }
  function prompt(opts) { return open(opts || {}, 'prompt'); }

  document.addEventListener('DOMContentLoaded', () => {
    if (!grab()) return;
    $ok.addEventListener('click', () => {
      close(mode === 'prompt' ? $input.value : true);
    });
    $cancel.addEventListener('click', () => close(mode === 'prompt' ? null : false));
    $modal.addEventListener('click', (e) => { if (e.target === $modal) close(mode === 'prompt' ? null : false); });
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close($input.value); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
    document.addEventListener('keydown', (e) => {
      if (!$modal.hidden && e.key === 'Escape') { e.preventDefault(); close(mode === 'prompt' ? null : false); }
    });
  });

  window.ShinobiDialog = { confirm, prompt };
})();
