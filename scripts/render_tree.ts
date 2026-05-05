import * as fs from 'fs';
import { renderTelemetryTree } from '../src/reader/HierarchicalReader.js';
const tel = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
console.log(renderTelemetryTree(tel));
