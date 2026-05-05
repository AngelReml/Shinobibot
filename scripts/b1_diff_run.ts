import { runSelfDiff } from '../src/reader/self.js';
const r = await runSelfDiff();
process.exit(r.ok ? 0 : 1);
