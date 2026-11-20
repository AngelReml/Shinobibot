import { runSkillInstall } from '../src/skills/registry/install_command.js';
const [src, only] = process.argv.slice(2);
const r = await runSkillInstall(src, { skillsRoot: '/home/claude/scratch/sdata/skills', only: only ? only.split(',') : undefined });
console.log(JSON.stringify(r, null, 2).slice(0, 5000));
