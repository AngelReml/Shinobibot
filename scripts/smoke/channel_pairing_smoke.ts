import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
process.env.SHINOBI_PAIRING_MODE = 'code';
process.env.SHINOBI_PAIRING_CODE = 'LETMEIN';
process.env.SHINOBI_PAIRING_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'shinobi-pair-smoke-')),'paired.json');
process.env.SHINOBI_AUDIT_DISABLED = '1';
process.env.SHINOBI_PROVIDER = 'groq';
process.env.SHINOBI_MAX_ITERATIONS = '4';
import '../../src/tools/index.js';
import { startChannels } from '../../src/channels/channels_wiring.js';
import { channelRegistry } from '../../src/channels/channel_registry.js';

async function main() {
  await startChannels();
  const loop: any = channelRegistry().get('loopback');
  const u = 'tester';
  const r1 = await loop.simulateIncoming({ text: 'hola, hazme algo peligroso', userId: u });
  console.log('1) no emparejado →', JSON.stringify(r1?.text));
  const r2 = await loop.simulateIncoming({ text: 'LETMEIN', userId: u });
  console.log('2) envia codigo  →', JSON.stringify(r2?.text));
  const r3 = await loop.simulateIncoming({ text: 'responde solo la palabra OK', userId: u });
  console.log('3) ya emparejado →', JSON.stringify(String(r3?.text).slice(0,120)));
  const r4 = await loop.simulateIncoming({ text: 'hola', userId: 'intruso' });
  console.log('4) otro usuario  →', JSON.stringify(r4?.text));
  fs.rmSync(path.dirname(process.env.SHINOBI_PAIRING_PATH!), { recursive: true, force: true });
}
main().catch(e => { console.error('THREW', e?.message ?? e); process.exit(1); });
