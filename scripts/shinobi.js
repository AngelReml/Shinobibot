#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tsFile = resolve(__dirname, 'shinobi.ts');

// Este wrapper permite ejecutar el CLI de Shinobi directamente desde el entry point configurado en package.json
// sin necesidad de pre-compilar a JS, delegando en 'tsx'.
const child = spawn('npx', ['tsx', tsFile, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
