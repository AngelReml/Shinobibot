// P5 standalone retry — runs committee once and inspects dissents.
import * as fs from 'fs';
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';
const target = findLatestSelfReport();
if (!target) { console.error('no self_report'); process.exit(1); }
const r = await runCommittee(target);
const data = JSON.parse(fs.readFileSync(r.outputPath, 'utf-8'));
const dissents = data?.synthesis?.dissents ?? [];
console.log(`\n[P5-final] dissents=${dissents.length}`);
if (dissents.length) console.log(`first dissent: "${dissents[0].topic}"`);
process.exit(dissents.length >= 1 ? 0 : 1);
