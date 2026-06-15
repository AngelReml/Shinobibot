/**
 * tenshu/spa/page.ts — TS-04 frontend (Bloque 8 / Claude Design, versión sobria
 * sin dependencias). Una SPA de un solo fichero que sondea /api/tenshu/state cada 2s
 * y renderiza VER · ENTENDER · CONDUCIR, con botones de pausa/kill/approve que POSTean
 * a /api/tenshu/command. Cero build, cero npm — HTML+CSS+JS inline.
 */

export const SPA_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>天守 · Tenshu — Puente de Mando</title>
<style>
  :root { --bg:#0b0e14; --card:#141a24; --line:#222b3a; --txt:#d7e0ee; --dim:#8a97ad; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --accent:#58a6ff; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.5 ui-monospace,Menlo,Consolas,monospace; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; letter-spacing:.5px; } header .dot { width:9px;height:9px;border-radius:50%;background:var(--ok); }
  header .meta { margin-left:auto; color:var(--dim); font-size:12px; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--dim); margin:0 0 10px; }
  .row { display:flex; justify-content:space-between; gap:8px; padding:5px 0; border-bottom:1px dashed var(--line); }
  .row:last-child { border-bottom:0; } .tag { padding:1px 7px; border-radius:6px; font-size:11px; }
  .running{background:#15351f;color:var(--ok)} .idle{background:#1b2230;color:var(--dim)} .paused{background:#3a2f12;color:var(--warn)} .halted{background:#3a1414;color:var(--bad)}
  button { background:#1b2230; color:var(--txt); border:1px solid var(--line); border-radius:7px; padding:5px 10px; cursor:pointer; font:inherit; font-size:12px; }
  button:hover{border-color:var(--accent)} button.bad{border-color:var(--bad);color:var(--bad)} button.warn{border-color:var(--warn);color:var(--warn)}
  pre { white-space:pre-wrap; color:var(--dim); font-size:12px; margin:0; max-height:240px; overflow:auto; }
  .chain-ok{color:var(--ok)} .chain-bad{color:var(--bad)} .controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .empty{color:var(--dim);font-style:italic}
</style>
</head>
<body>
<header>
  <span class="dot" id="live"></span><h1>天守 Tenshu — Puente de Mando</h1>
  <span class="meta" id="meta">conectando…</span>
</header>
<main>
  <section class="card"><h2>VER · Subsistemas</h2><div id="subsystems"></div>
    <div class="controls">
      <button class="warn" onclick="cmd('pause','all')">⏸ Pausar todo</button>
      <button class="bad" onclick="cmd('kill','all')">⏻ Kill switch (todo)</button>
    </div>
  </section>
  <section class="card"><h2>VER · Mapa vivo</h2><pre id="map"></pre></section>
  <section class="card"><h2>CONDUCIR · Aprobaciones pendientes ⚑</h2><div id="approvals"></div></section>
  <section class="card"><h2>ENTENDER · Traza verificable (TEV)</h2><div id="tevchain"></div><pre id="tev"></pre></section>
</main>
<script>
async function refresh(){
  try{
    const r = await fetch('/api/tenshu/state'); const s = await r.json();
    document.getElementById('live').style.background = 'var(--ok)';
    document.getElementById('meta').textContent = 'tokens '+s.status.budgets.tokensSpent+'/'+s.status.budgets.tokensCap+' · integridad '+s.status.integrity_mode+' · '+new Date().toLocaleTimeString();
    document.getElementById('subsystems').innerHTML = s.status.subsystems.map(function(x){
      return '<div class="row"><span>'+x.name+(x.phase?' · '+x.phase:'')+'</span><span class="tag '+x.state+'">'+x.state+'</span></div>';
    }).join('') || '<div class="empty">sin subsistemas</div>';
    document.getElementById('map').textContent = s.map.nodes.map(function(n){return n.source+': '+n.state+' ('+n.event_count+' ev)';}).join('\\n')
      + '\\n— flujos —\\n' + s.map.edges.map(function(e){return e.from+' → '+e.to+' ['+e.flow+']';}).join('\\n');
    document.getElementById('approvals').innerHTML = s.approvals.length ? s.approvals.map(function(a){
      return '<div class="row"><span>'+a.source+': '+a.summary+'</span><span>'
        +'<button onclick="cmd(\\'approve\\',\\''+a.source+'\\',\\''+a.id+'\\')">✓</button> '
        +'<button class="bad" onclick="cmd(\\'reject\\',\\''+a.source+'\\',\\''+a.id+'\\')">✗</button></span></div>';
    }).join('') : '<div class="empty">ninguna — nada irreversible esperando</div>';
    var ch = s.tev.linkage;
    document.getElementById('tevchain').innerHTML = '<div class="'+(ch.ok?'chain-ok':'chain-bad')+'">cadena: '
      +(ch.ok?('íntegra, '+ch.length+' eslabones'):('ROTA en '+ch.broken_at))+'</div>';
    document.getElementById('tev').textContent = s.tev.summary;
  }catch(e){ document.getElementById('live').style.background='var(--bad)'; document.getElementById('meta').textContent='sin conexión'; }
}
async function cmd(command,target,approval_id){
  await fetch('/api/tenshu/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:command,target:target,args:approval_id?{approval_id:approval_id}:undefined})});
  refresh();
}
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>`;
