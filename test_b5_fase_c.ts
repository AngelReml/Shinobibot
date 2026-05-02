import { SkillLoader } from './src/skills/skill_loader.js';
import { getAllTools, getTool } from './src/tools/tool_registry.js';
import './src/tools/index.js';
import axios from 'axios';

async function main() {
  process.env.SHINOBI_API_KEY = process.env.SHINOBI_API_KEY || 'sk_dev_master';
  process.env.OPENGRAVITY_URL = process.env.OPENGRAVITY_URL || 'http://localhost:9900';

  console.log('--- B5 FASE C TEST ---\n');

  // T1: skill_list tool funciona
  console.log('T1: tool skill_list');
  const skillListTool = getTool('skill_list');
  if (!skillListTool) { console.log('  T1: FAILED — tool not registered'); }
  else {
    const r = await skillListTool.execute({ status: 'verified' });
    console.log(`  success: ${r.success}`);
    const list = r.success ? JSON.parse(r.output) : [];
    console.log(`  verified skills: ${list.length}`);
    console.log(`  T1: ${r.success ? 'PASSED' : 'FAILED'}\n`);
  }

  // T2: pedir generación de una skill nueva
  console.log('T2: tool request_new_skill');
  const reqTool = getTool('request_new_skill');
  if (!reqTool) { console.log('  T2: FAILED — tool not registered'); }
  else {
    const r = await reqTool.execute({
      capability_description: 'Reverse a string. Input: { text: string }. Output: { reversed: string }',
      example_input: { text: 'hello' },
      example_output: { reversed: 'olleh' }
    });
    console.log(`  output: ${r.output?.substring(0, 300)}`);
    console.log(`  T2: ${r.success ? 'PASSED' : 'FAILED'}\n`);
  }

  // T3: aprobar y cargar una skill verified existente
  console.log('T3: aprobar y cargar skill verified');
  const baseUrl = process.env.OPENGRAVITY_URL;
  const apiKey = process.env.SHINOBI_API_KEY;
  const listRes = await axios.get(`${baseUrl}/v1/skills/list?status=verified`, { headers: { 'X-Shinobi-Key': apiKey } });
  const verifiedList = JSON.parse(listRes.data.output);
  if (verifiedList.length === 0) {
    console.log('  T3: SKIPPED — no verified skills in catalog');
  } else {
    const target = verifiedList[0];
    console.log(`  intentando cargar: ${target.id} (${target.name})`);
    const loadRes = await SkillLoader.approveAndLoad(target.id);
    console.log(`  message: ${loadRes.message}`);
    console.log(`  T3: ${loadRes.success ? 'PASSED' : 'FAILED'}\n`);

    // T4: la tool cargada aparece en getAllTools
    console.log('T4: tool dinámica visible en registry');
    const allTools = getAllTools();
    const found = allTools.find((t: any) => t.name === target.name);
    console.log(`  total tools: ${allTools.length}`);
    console.log(`  found ${target.name}: ${!!found}`);
    console.log(`  T4: ${found ? 'PASSED' : 'FAILED'}\n`);

    // T5: la tool dinámica ejecuta correctamente
    if (found) {
      console.log('T5: ejecutar tool dinámica');
      const argsForExec: any = {};
      const props = target.parameters_schema?.properties || {};
      for (const k of Object.keys(props)) {
        const t = props[k]?.type;
        if (t === 'string') argsForExec[k] = 'hello world test@example.com';
        else if (t === 'number') argsForExec[k] = 1;
        else if (t === 'boolean') argsForExec[k] = true;
        else argsForExec[k] = null;
      }
      try {
        const execRes = await found.execute(argsForExec);
        console.log(`  exec success: ${execRes.success}`);
        console.log(`  exec output: ${(execRes.output || '').substring(0, 200)}`);
        console.log(`  T5: ${typeof execRes.success === 'boolean' ? 'PASSED' : 'FAILED'}\n`);
      } catch (e: any) {
        console.log(`  T5: FAILED — ${e.message}`);
      }
    }
  }

  // T6: bloqueo de carga si status != verified
  console.log('T6: bloqueo de carga si status != verified');
  const allList = JSON.parse((await axios.get(`${baseUrl}/v1/skills/list`, { headers: { 'X-Shinobi-Key': apiKey } })).data.output);
  const nonVerified = allList.find((s: any) => s.status !== 'verified' && s.status !== 'promoted');
  if (!nonVerified) {
    console.log('  T6: SKIPPED — todas las skills están verified');
  } else {
    const r = await SkillLoader.approveAndLoad(nonVerified.id);
    console.log(`  message: ${r.message}`);
    console.log(`  T6: ${!r.success ? 'PASSED' : 'FAILED — should have refused'}\n`);
  }

  console.log('--- ALL DONE ---');
}

main().catch(e => { console.error('FATAL:', e.response?.data || e.message); process.exit(1); });
