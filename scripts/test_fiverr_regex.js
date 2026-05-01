const s = '28. [Extraeré...] -> https://es.fiverr.com/vivekpatel99/do-end-to-end-computer-vision-projects?context_referrer=search_gigs';
const m = s.match(/https:\/\/[a-z.]*fiverr\.com\/[a-z0-9_-]+\/[a-z0-9-]{8,}/gi);
console.log(m);
