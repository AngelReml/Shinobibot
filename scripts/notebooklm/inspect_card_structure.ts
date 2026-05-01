import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const pages = browser.contexts().flatMap(c => c.pages());
  const page = pages.find(p => p.url().includes('notebooklm.google.com'));
  if (!page) { console.error('no notebooklm tab'); process.exit(1); }
  
  const inventory = await page.evaluate(() => {
    // Buscar el primer botón more_vert y subir por el árbol de ancestros
    const moreVert = document.querySelector('button[aria-label*="proyecto" i]');
    if (!moreVert) return { error: 'no more_vert button found' };
    
    // Subir 8 niveles y reportar cada ancestro
    const ancestors: any[] = [];
    let el: Element | null = moreVert;
    for (let i = 0; i < 8 && el; i++) {
      const tag = el.tagName.toLowerCase();
      const id = el.id || '';
      const classes = el.className || '';
      const role = el.getAttribute('role') || '';
      const aria = el.getAttribute('aria-label') || '';
      const href = el.getAttribute('href') || '';
      const dataAttrs: any = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value;
      }
      const text = ((el as any).innerText || '').trim().slice(0, 100);
      const clickable = (tag === 'a' || tag === 'button' || role === 'button' || role === 'link');
      ancestors.push({ level: i, tag, id, classes: typeof classes === 'string' ? classes : '', role, aria_label: aria, href, data_attrs: dataAttrs, text_preview: text, looks_clickable: clickable });
      el = el.parentElement;
    }
    
    // También listar todos los <a> del documento que podrían ser notebooks
    const allAnchors = Array.from(document.querySelectorAll('a')).slice(0, 40).map(a => ({
      href: a.href,
      aria: a.getAttribute('aria-label') || '',
      text: ((a as HTMLElement).innerText || '').trim().slice(0, 80)
    })).filter(x => x.href || x.aria);
    
    // Y todos los elementos clickables con role=button que NO sean more_vert
    const buttons = Array.from(document.querySelectorAll('[role="button"]')).slice(0, 30).map(b => ({
      aria: b.getAttribute('aria-label') || '',
      text: ((b as HTMLElement).innerText || '').trim().slice(0, 80),
      classes: typeof b.className === 'string' ? b.className.slice(0, 100) : ''
    })).filter(b => !b.aria.toLowerCase().includes('proyecto'));
    
    return {
      ancestors_of_first_more_vert: ancestors,
      all_anchors_sample: allAnchors,
      role_buttons_non_more_vert: buttons,
      page_url: window.location.href
    };
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/card_structure_inspection.json', JSON.stringify(inventory, null, 2));
  console.log('INSPECTION DONE. See artifacts/notebooklm/card_structure_inspection.json');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
