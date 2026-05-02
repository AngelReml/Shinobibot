import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const log: any[] = [];
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const page = allPages.find(p => p.url().includes('youtube.com/watch'));
  
  if (!page) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
      error: 'NO YOUTUBE WATCH TAB',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('Y4: pestaña debe estar en youtube.com/watch');
    process.exit(1);
  }
  
  log.push({ step: 'find_page', url: page.url() });
  
  // Scroll inicial para activar lazy load de comentarios
  // YouTube carga comentarios cuando el viewport se acerca a su sección
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(1500);
    
    // Verificar si ya aparecieron hilos
    const count = await page.locator('ytd-comment-thread-renderer').count();
    if (count > 0) {
      log.push({ step: 'threads_detected_during_scroll', count, cycles: i + 1 });
      break;
    }
  }
  
  // Esperar explícitamente a que aparezca al menos un hilo
  try {
    await page.waitForSelector('ytd-comment-thread-renderer', { timeout: 10000 });
    log.push({ step: 'wait_for_threads_success' });
  } catch (e: any) {
    log.push({ step: 'wait_for_threads_timeout', error: e.message });
  }

  // Verificar si la sección de comentarios está cargada
  const commentsSectionState = await page.evaluate(() => {
    const section = document.querySelector('ytd-comments, #comments');
    const header = document.querySelector('ytd-comments-header-renderer #count, ytd-comments-header-renderer h2');
    return {
      section_exists: !!section,
      header_text: header ? (header as HTMLElement).innerText.trim() : '',
      total_comment_threads: document.querySelectorAll('ytd-comment-thread-renderer').length
    };
  });
  log.push({ step: 'comments_section_check', ...commentsSectionState });
  
  // Si no hay comments todavía, scrollear más agresivo
  if (commentsSectionState.total_comment_threads === 0) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(1500);
    }
    log.push({ step: 'aggressive_scroll', cycles: 5 });
  }
  
  // Scroll dentro de la sección de comentarios para cargar más threads
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(1500);
  }
  log.push({ step: 'comments_scroll', cycles: 6 });
  
  // Extraer comentarios estructurados desde el DOM
  const commentsData = await page.evaluate(() => {
    const threads = document.querySelectorAll('ytd-comment-thread-renderer');
    const comments: any[] = [];
    for (let i = 0; i < threads.length && comments.length < 50; i++) {
      const t = threads[i];
      const authorEl = t.querySelector('#author-text, a#author-text');
      const contentEl = t.querySelector('#content-text, yt-attributed-string#content-text');
      const likesEl = t.querySelector('#vote-count-middle, [id="vote-count-middle"]');
      const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : '';
      const content = contentEl ? (contentEl as HTMLElement).innerText.trim() : '';
      const likes = likesEl ? (likesEl as HTMLElement).innerText.trim() : '';
      if (author || content) {
        comments.push({
          author: author.slice(0, 100),
          content: content.slice(0, 500),
          likes
        });
      }
    }
    
    // Sección header (cuenta total)
    const header = document.querySelector('ytd-comments-header-renderer #count, ytd-comments-header-renderer h2 yt-formatted-string');
    const headerText = header ? (header as HTMLElement).innerText.trim() : '';
    
    return {
      total_threads_in_dom: threads.length,
      comments_extracted: comments.length,
      header_count: headerText,
      comments
    };
  });
  log.push({ step: 'extract_comments', ...{ total_in_dom: commentsData.total_threads_in_dom, extracted: commentsData.comments_extracted } });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
    page_url: page.url(),
    comment_section_found: commentsData.total_threads_in_dom > 0,
    header_count_text: commentsData.header_count,
    total_threads_in_dom: commentsData.total_threads_in_dom,
    comments_extracted: commentsData.comments_extracted,
    comments: commentsData.comments,
    log
  }, null, 2));
  
  console.log(`Y4: section_found=${commentsData.total_threads_in_dom > 0} | threads=${commentsData.total_threads_in_dom} | extracted=${commentsData.comments_extracted} | header="${commentsData.header_count}"`);
}

main().catch(e => { console.error('Y4 ERROR:', e.message); process.exit(1); });
