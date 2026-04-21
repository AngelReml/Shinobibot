#!/usr/bin/env node
/**
 * Shinobi CLI v5 - Connected to OpenGravity Kernel
 */

import * as readline from 'readline';
import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function checkKernel(): Promise<boolean> {
  const online = await KernelClient.isOnline();
  if (online) {
    console.log('🟢 OpenGravity Kernel: ONLINE');
  } else {
    console.log('🟡 OpenGravity Kernel: OFFLINE (using local mode)');
    console.log('   To enable kernel: run "kernel.cmd" in OpenGravity folder');
  }
  return online;
}

async function main() {
  console.log('\n--- SHINOBIBOT CLI V5 (KERNEL CONNECTED) ---');
  console.log('Escribe tu orden o "exit" para salir.');
  console.log('Comandos especiales:');
  console.log('  /mode local  - Forzar modo local');
  console.log('  /mode kernel - Forzar modo kernel');
  console.log('  /mode auto   - Modo automático (default)');
  console.log('  /status      - Ver estado del kernel');
  console.log('');
  
  await checkKernel();
  console.log('');
  
  const prompt = () => {
    rl.question('Shinobi > ', async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }
      
      if (trimmed.toLowerCase() === 'exit') {
        console.log('Hasta luego.');
        rl.close();
        process.exit(0);
      }
      
      // Special commands
      if (trimmed.startsWith('/mode ')) {
        const mode = trimmed.split(' ')[1] as 'local' | 'kernel' | 'auto';
        if (['local', 'kernel', 'auto'].includes(mode)) {
          ShinobiOrchestrator.setMode(mode);
        } else {
          console.log('Modos válidos: local, kernel, auto');
        }
        prompt();
        return;
      }
      
      if (trimmed === '/status') {
        await checkKernel();
        prompt();
        return;
      }
      
      // Process request
      console.log('[Engine procesando...]');
      
      try {
        const result = await ShinobiOrchestrator.process(trimmed);
        if (result && (result as any).output) {
            console.log('\n--- FINAL MISSION OUTPUT ---');
            console.log((result as any).output);
            console.log('----------------------------\n');
        }
        console.log(JSON.stringify(result, null, 2));
      } catch (err: any) {
        console.error('Error:', err.message);
      }
      
      prompt();
    });
  };
  
  prompt();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});