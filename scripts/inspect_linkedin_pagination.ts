import { chromium } from 'playwright';

async function inspect() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());
  const linkedinPage = pages.find(p => p.url().includes('linkedin.com/search/results/people'));
  
  if (!linkedinPage) {
    console.log('No LinkedIn search page found. Open one first.');
    return;
  }
  
  console.log('Found LinkedIn page:', linkedinPage.url());
  console.log('---');
  
  const info = await linkedinPage.evaluate(() => {
    const result: any = {};
    
    result.scrollHeight = document.documentElement.scrollHeight;
    result.viewportHeight = window.innerHeight;
    result.currentScroll = window.scrollY;
    
    const seeMoreButtons: string[] = [];
    const buttons = document.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      const text = (buttons[i].innerText || '').trim();
      if (text && (text.toLowerCase().includes('more') || text.toLowerCase().includes('see all') || text.toLowerCase().includes('next') || text.toLowerCase().includes('siguiente'))) {
        seeMoreButtons.push(text);
      }
    }
    result.seeMoreButtons = seeMoreButtons;
    
    const paginationLinks: string[] = [];
    const allLinks = document.querySelectorAll('a[href*="page="]');
    for (let i = 0; i < allLinks.length && paginationLinks.length < 10; i++) {
      paginationLinks.push((allLinks[i] as HTMLAnchorElement).href);
    }
    result.paginationLinks = paginationLinks;
    
    const profileLinks = document.querySelectorAll('a[href*="/in/"]');
    result.profileLinkCount = profileLinks.length;
    
    const ariaLive = document.querySelectorAll('[aria-live]');
    const ariaLabels: string[] = [];
    for (let i = 0; i < ariaLive.length && ariaLabels.length < 5; i++) {
      const label = ariaLive[i].getAttribute('aria-label') || (ariaLive[i] as HTMLElement).innerText.slice(0, 100);
      if (label) ariaLabels.push(label);
    }
    result.ariaLiveRegions = ariaLabels;
    
    return result;
  });
  
  console.log(JSON.stringify(info, null, 2));
}

inspect().catch(e => console.error(e));
