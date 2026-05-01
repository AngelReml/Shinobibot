import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  let channelUrl = '';
  try {
    const channels = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_channel_urls.json', 'utf-8'));
    if (channels.length > 0) channelUrl = channels[0];
  } catch {}
  
  if (!channelUrl) {
    console.error('Y5: no channel URL from Y1');
    process.exit(1);
  }
  
  // Apuntar directamente a la pestaña /videos del canal
  const videosUrl = channelUrl.endsWith('/videos') ? channelUrl : channelUrl + '/videos';
  
  const r = await search.execute({ query: videosUrl });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y5_channel_raw.json', JSON.stringify(r, null, 2));
  
  const watchUrls = Array.from(new Set((r.output.match(/https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/g) || [])));
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y5_channel_videos.json', JSON.stringify({
    channel_url: channelUrl,
    videos_url: videosUrl,
    page_title: title,
    video_count: watchUrls.length,
    video_urls: watchUrls
  }, null, 2));
  console.log(`Y5: channel=${channelUrl} | videos_extracted=${watchUrls.length}`);
}

main().catch(e => { console.error('Y5 ERROR:', e.message); process.exit(1); });
