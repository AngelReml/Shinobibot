import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  let target = '';
  try {
    const data = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', 'utf-8'));
    if (data.notebook_urls && data.notebook_urls.length > 0) target = data.notebook_urls[0];
  } catch {}
  
  if (!target) {
    console.error('N2: no notebook URL from N1');
    process.exit(1);
  }
  
  const r = await search.execute({ query: target });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_notebook_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  // En el panel de Sources, NotebookLM lista nombres de archivos/URLs
  // Heurísticas: extensiones de archivo + dominios web + checkboxes / titulares
  const fileExtensions = Array.from(new Set((body.match(/[\w\s\-.]+\.(?:pdf|txt|docx|md|html|epub|mp3|mp4)/gi) || [])));
  const externalUrls = Array.from(new Set((body.match(/https?:\/\/(?!notebooklm\.google\.com|accounts\.google\.com|policies\.google\.com)[^\s)\]]+/gi) || [])));
  
  // Sección de sources — buscar marcadores
  const sourcesSectionMarkers = [
    /Sources/i,
    /Fuentes/i,
    /Add\s+source/i,
    /Añadir\s+fuente/i
  ];
  let sourcesSectionFound = false;
  for (const m of sourcesSectionMarkers) {
    if (m.test(body)) { sourcesSectionFound = true; break; }
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_sources.json', JSON.stringify({
    notebook_url: target,
    page_title: title,
    body_length: body.length,
    sources_section_detected: sourcesSectionFound,
    file_names_detected: fileExtensions,
    external_urls_detected: externalUrls.slice(0, 30),
    body_preview: body.substring(0, 2500)
  }, null, 2));
  console.log(`N2: notebook=${target} | sources_section=${sourcesSectionFound} | files=${fileExtensions.length} | urls=${externalUrls.length}`);
}

main().catch(e => { console.error('N2 ERROR:', e.message); process.exit(1); });
