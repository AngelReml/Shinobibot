import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const KEYWORD = 'autonomous browser agent';
const URL = `https://www.youtube.com/results?search_query=${encodeURIComponent(KEYWORD)}`;

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_raw.json', JSON.stringify(r, null, 2));
  
  // YouTube watch URLs: /watch?v=<id>
  const watchUrls = Array.from(new Set((r.output.match(/https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/g) || [])));
  // Channel URLs
  const channelUrls = Array.from(new Set((r.output.match(/https:\/\/www\.youtube\.com\/(?:@[a-zA-Z0-9._-]+|channel\/[a-zA-Z0-9_-]+|c\/[a-zA-Z0-9_-]+)/g) || [])));
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_video_urls.json', JSON.stringify(watchUrls, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_channel_urls.json', JSON.stringify(channelUrls, null, 2));
  console.log(`Y1: videos=${watchUrls.length} | channels=${channelUrls.length}`);
}

main().catch(e => { console.error('Y1 ERROR:', e.message); process.exit(1); });
