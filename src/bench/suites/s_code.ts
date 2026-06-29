// S-CODE v1 — suite de programación determinista (PLAN_SOMBRA G1).
//
// 25 tareas de coding + tool_use con check DETERMINISTA por máquina. Sin LLM-judge.
// Categorías: coding (algoritmos puros, node -e) y tool_use (lectura/escritura de
// ficheros en el workdir). Cada tarea es autocontenida y corre en workdir aislado.
//
// Versión congelada: NO se edita entre corridas comparadas. Cambiar una tarea = v1.1.
// Estado: v1.0 (25 tareas canónicas). Crecer a 50 antes de G2 si la señal lo justifica.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BenchTask } from '../types.js';

export const S_CODE_VERSION = 'v1.0';

function nodeCheck(workdir: string, script: string): { ok: boolean; detail: string } {
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: workdir, encoding: 'utf-8', timeout: 15_000,
  });
  return { ok: (r.status ?? 1) === 0, detail: (r.stderr || r.stdout || '').trim().slice(0, 200) };
}

function readFile(workdir: string, rel: string): string | null {
  const p = path.join(workdir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

export const S_CODE_TASKS: BenchTask[] = [

  // ── Algoritmos puros (check: node -e) ────────────────────────────────────

  {
    id: 'code-add',
    category: 'coding',
    prompt: 'Crea un fichero sum.js en el directorio actual que exporte (con module.exports) una función add(a, b) que devuelva a + b.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir, "const m=require('./sum.js');if(typeof m.add!=='function'||m.add(2,3)!==5||m.add(-1,1)!==0||m.add(0,0)!==0)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'add(2,3)=5, add(-1,1)=0' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'code-fizzbuzz',
    category: 'coding',
    prompt:
      'Crea fizzbuzz.js en el directorio actual que exporte fizzBuzz(n) → array de strings ' +
      'de longitud n: múltiplos de 3="Fizz", de 5="Buzz", de ambos="FizzBuzz", resto=string del número.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {fizzBuzz}=require('./fizzbuzz.js');" +
        "const r=fizzBuzz(15);" +
        "if(r[2]!=='Fizz'||r[4]!=='Buzz'||r[14]!=='FizzBuzz'||r[0]!=='1'||r[1]!=='2')process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'fizzBuzz(15) correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-fibonacci',
    category: 'coding',
    prompt:
      'Crea fib.js en el directorio actual que exporte fib(n) → el n-ésimo número de Fibonacci ' +
      '(fib(0)=0, fib(1)=1, fib(2)=1, fib(10)=55).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {fib}=require('./fib.js');" +
        "if(fib(0)!==0||fib(1)!==1||fib(2)!==1||fib(10)!==55||fib(6)!==8)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'fib(0..10) correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-palindrome',
    category: 'coding',
    prompt:
      'Crea palindrome.js en el directorio actual que exporte isPalindrome(s) → boolean. ' +
      'Considera solo letras y dígitos (ignorando mayúsculas y caracteres no alfanuméricos).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {isPalindrome}=require('./palindrome.js');" +
        "if(!isPalindrome('racecar')||isPalindrome('hello')||!isPalindrome('level')||" +
        "!isPalindrome('A man a plan a canal Panama')||isPalindrome('abc'))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'palindrome checks ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-flatten',
    category: 'coding',
    prompt:
      'Crea flatten.js en el directorio actual que exporte flatten(arr) que aplane arrays ' +
      'anidados a cualquier profundidad en un único array plano.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {flatten}=require('./flatten.js');" +
        "const r=flatten([1,[2,[3,[4]],5]]);" +
        "if(JSON.stringify(r)!==JSON.stringify([1,2,3,4,5]))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'flatten([[1,[2,[3,[4]],5]])=[1,2,3,4,5]' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-twosum',
    category: 'coding',
    prompt:
      'Crea twosum.js en el directorio actual que exporte twoSum(nums, target) → [i, j] ' +
      'tal que nums[i] + nums[j] === target. Garantizado que existe exactamente una solución.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {twoSum}=require('./twosum.js');" +
        "const a=[2,7,11,15];const r=twoSum(a,9);" +
        "if(!r||a[r[0]]+a[r[1]]!==9)process.exit(1);" +
        "const b=[3,2,4];const s=twoSum(b,6);if(!s||b[s[0]]+b[s[1]]!==6)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'twoSum([2,7,11,15],9) y twoSum([3,2,4],6) ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-memoize',
    category: 'coding',
    prompt:
      'Crea memoize.js en el directorio actual que exporte memoize(fn) → función memoizada ' +
      'que cachea resultados por argumentos (usando JSON.stringify como clave).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {memoize}=require('./memoize.js');" +
        "let calls=0;" +
        "const add=(a,b)=>{calls++;return a+b};" +
        "const m=memoize(add);" +
        "m(1,2);m(1,2);m(2,3);" +
        "if(calls!==2||m(1,2)!==3||m(2,3)!==5)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'memoize evita recómputo y da resultado correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-chunk',
    category: 'coding',
    prompt:
      'Crea chunk.js en el directorio actual que exporte chunk(arr, size) que divida el ' +
      'array en sub-arrays de tamaño size (el último puede ser más pequeño).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {chunk}=require('./chunk.js');" +
        "const r=chunk([1,2,3,4,5],2);" +
        "if(JSON.stringify(r)!==JSON.stringify([[1,2],[3,4],[5]]))process.exit(1);" +
        "const r2=chunk([1,2,3],3);" +
        "if(JSON.stringify(r2)!==JSON.stringify([[1,2,3]]))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'chunk([1..5],2) y chunk([1..3],3) ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-deepclone',
    category: 'coding',
    prompt:
      'Crea deepclone.js en el directorio actual que exporte deepClone(obj) que devuelva ' +
      'una copia profunda del objeto sin referencias compartidas con el original.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {deepClone}=require('./deepclone.js');" +
        "const o={a:{b:[1,2,3]},c:'hello'};" +
        "const c=deepClone(o);" +
        "c.a.b.push(4);c.c='world';" +
        "if(o.a.b.length!==3||o.c!=='hello'||c.a.b.length!==4)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'deepClone sin referencias compartidas' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-groupby',
    category: 'coding',
    prompt:
      'Crea groupby.js en el directorio actual que exporte groupBy(arr, key) → objeto ' +
      'donde cada clave agrupa los ítems del array que comparten ese valor de campo.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {groupBy}=require('./groupby.js');" +
        "const r=groupBy([{t:'a',v:1},{t:'b',v:2},{t:'a',v:3}],'t');" +
        "if(!r.a||r.a.length!==2||!r.b||r.b.length!==1||r.a[0].v!==1)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'groupBy agrupa correctamente' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  // ── Ficheros I/O (check: inspección del workdir) ──────────────────────────

  {
    id: 'code-filter-json',
    category: 'tool_use',
    prompt:
      'Lee el fichero items.json del directorio actual. Filtra solo los ítems con active:true ' +
      'y escribe el resultado en active.json (array JSON).',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'items.json'),
        JSON.stringify([
          { id: 1, name: 'alpha', active: true },
          { id: 2, name: 'beta', active: false },
          { id: 3, name: 'gamma', active: true },
          { id: 4, name: 'delta', active: false },
        ]),
      );
    },
    async check(ctx) {
      const raw = readFile(ctx.workdir, 'active.json');
      if (!raw) return { pass: false, detail: 'active.json no existe' };
      try {
        const data = JSON.parse(raw);
        const pass = Array.isArray(data) && data.length === 2 && data.every((x: any) => x.active === true);
        return { pass, detail: pass ? '2 ítems activos en active.json' : `encontrados ${data.length} ítems: ${raw.slice(0, 100)}` };
      } catch {
        return { pass: false, detail: 'active.json no es JSON válido' };
      }
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-csv-to-json',
    category: 'tool_use',
    prompt:
      'Lee people.csv del directorio actual (formato: name,age) y conviértelo en ' +
      'people.json con un array de objetos {name: string, age: number}.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'people.csv'),
        'name,age\nAlice,30\nBob,25\nCharlie,35\n',
      );
    },
    async check(ctx) {
      const raw = readFile(ctx.workdir, 'people.json');
      if (!raw) return { pass: false, detail: 'people.json no existe' };
      try {
        const data = JSON.parse(raw);
        const pass =
          Array.isArray(data) && data.length === 3 &&
          data.some((p: any) => p.name === 'Alice' && Number(p.age) === 30) &&
          data.some((p: any) => p.name === 'Bob' && Number(p.age) === 25);
        return { pass, detail: pass ? 'people.json con 3 registros correctos' : `contenido: ${raw.slice(0, 100)}` };
      } catch {
        return { pass: false, detail: 'people.json no es JSON válido' };
      }
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-sort-json',
    category: 'tool_use',
    prompt:
      'Lee scores.json del directorio actual (array de {name, score}) y escribe sorted.json ' +
      'con los mismos ítems ordenados por score DESCENDENTE.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'scores.json'),
        JSON.stringify([
          { name: 'Beta', score: 70 },
          { name: 'Alpha', score: 90 },
          { name: 'Gamma', score: 80 },
          { name: 'Delta', score: 60 },
        ]),
      );
    },
    async check(ctx) {
      const raw = readFile(ctx.workdir, 'sorted.json');
      if (!raw) return { pass: false, detail: 'sorted.json no existe' };
      try {
        const data = JSON.parse(raw);
        const pass =
          Array.isArray(data) && data.length === 4 &&
          data[0].score >= data[1].score &&
          data[1].score >= data[2].score &&
          data[2].score >= data[3].score &&
          data[0].name === 'Alpha';
        return { pass, detail: pass ? 'sorted.json orden desc correcto (Alpha=90 primero)' : `orden: ${data.map((x: any) => x.score).join(',')}` };
      } catch {
        return { pass: false, detail: 'sorted.json no es JSON válido' };
      }
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-template-render',
    category: 'tool_use',
    prompt:
      'Lee template.txt del directorio actual. Sustituye {{name}} por "Shinobi" y {{code}} por ' +
      '"X-42". Escribe el resultado en output.txt.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'template.txt'),
        'Hola {{name}}, tu código de acceso es {{code}}. Bienvenido, {{name}}.',
      );
    },
    async check(ctx) {
      const out = readFile(ctx.workdir, 'output.txt');
      if (!out) return { pass: false, detail: 'output.txt no existe' };
      const pass =
        out.includes('Shinobi') && out.includes('X-42') &&
        !out.includes('{{name}}') && !out.includes('{{code}}');
      return { pass, detail: pass ? 'placeholders sustituidos' : `output: "${out.slice(0, 120)}"` };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'code-merge-json-arrays',
    category: 'tool_use',
    prompt:
      'Lee a.json y b.json del directorio actual (ambos arrays de números) y escribe merged.json ' +
      'con todos los números del array a seguidos de los del array b.',
    async setup(ctx) {
      fs.writeFileSync(path.join(ctx.workdir, 'a.json'), JSON.stringify([1, 2, 3]));
      fs.writeFileSync(path.join(ctx.workdir, 'b.json'), JSON.stringify([4, 5, 6]));
    },
    async check(ctx) {
      const raw = readFile(ctx.workdir, 'merged.json');
      if (!raw) return { pass: false, detail: 'merged.json no existe' };
      try {
        const data = JSON.parse(raw);
        const pass = Array.isArray(data) && data.length === 6 &&
          data[0] === 1 && data[5] === 6;
        return { pass, detail: pass ? 'merged.json=[1,2,3,4,5,6]' : `contenido: ${raw.slice(0, 80)}` };
      } catch {
        return { pass: false, detail: 'merged.json no es JSON válido' };
      }
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'code-word-stats',
    category: 'tool_use',
    prompt:
      'Lee text.txt del directorio actual y escribe stats.json con un objeto ' +
      '{words: número_total_de_palabras, unique: número_de_palabras_únicas}.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'text.txt'),
        'hello world hello foo bar world hello\n',
      );
    },
    async check(ctx) {
      const raw = readFile(ctx.workdir, 'stats.json');
      if (!raw) return { pass: false, detail: 'stats.json no existe' };
      try {
        const data = JSON.parse(raw);
        const wordsOk = Number(data.words) === 7;
        const uniqueOk = Number(data.unique) === 4;
        const pass = wordsOk && uniqueOk;
        return { pass, detail: pass ? 'words=7, unique=4' : `got words=${data.words} unique=${data.unique}` };
      } catch {
        return { pass: false, detail: 'stats.json no es JSON válido' };
      }
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-find-replace',
    category: 'tool_use',
    prompt:
      'Lee source.txt del directorio actual. Reemplaza TODAS las ocurrencias de "TODO" ' +
      'por "DONE" y escribe el resultado en result.txt.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'source.txt'),
        'TODO: fix the bug\nDone: deploy\nTODO: write tests\nNOTES: nothing TODO here actually\n',
      );
    },
    async check(ctx) {
      const out = readFile(ctx.workdir, 'result.txt');
      if (!out) return { pass: false, detail: 'result.txt no existe' };
      const todos = (out.match(/\bTODO\b/g) ?? []).length;
      const dones = (out.match(/\bDONE\b/g) ?? []).length;
      const pass = todos === 0 && dones >= 3;
      return { pass, detail: pass ? `0 TODOs, ${dones} DONEs` : `quedaron ${todos} TODOs, ${dones} DONEs` };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'code-unique-lines',
    category: 'tool_use',
    prompt:
      'Lee data.txt del directorio actual. Elimina líneas duplicadas, ordénalas ' +
      'alfabéticamente y escribe el resultado en unique.txt (una línea por entrada).',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'data.txt'),
        'banana\napple\nbanana\ncherry\napple\ndate\ncherry\n',
      );
    },
    async check(ctx) {
      const out = readFile(ctx.workdir, 'unique.txt');
      if (!out) return { pass: false, detail: 'unique.txt no existe' };
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const pass =
        lines.length === 4 &&
        JSON.stringify(lines) === JSON.stringify(['apple', 'banana', 'cherry', 'date']);
      return { pass, detail: pass ? 'unique.txt con 4 líneas únicas ordenadas' : `líneas: ${JSON.stringify(lines)}` };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-extract-numbers',
    category: 'tool_use',
    prompt:
      'Lee report.txt del directorio actual. Extrae todos los números enteros que aparezcan ' +
      'en el texto y escríbelos en numbers.txt, uno por línea, en orden de aparición.',
    async setup(ctx) {
      fs.writeFileSync(
        path.join(ctx.workdir, 'report.txt'),
        'El precio es 42 euros. La cantidad: 100. Total: 142 ítems procesados.\n',
      );
    },
    async check(ctx) {
      const out = readFile(ctx.workdir, 'numbers.txt');
      if (!out) return { pass: false, detail: 'numbers.txt no existe' };
      const nums = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const pass =
        nums.length === 3 &&
        nums[0] === '42' && nums[1] === '100' && nums[2] === '142';
      return { pass, detail: pass ? 'numbers.txt: 42, 100, 142' : `obtenido: ${JSON.stringify(nums)}` };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-log-summary',
    category: 'tool_use',
    prompt:
      'Lee todos los ficheros .log del directorio actual y escribe summary.txt con el ' +
      'número de líneas de cada fichero en el formato "nombre.log: N líneas".',
    async setup(ctx) {
      fs.writeFileSync(path.join(ctx.workdir, 'app.log'), 'línea\n'.repeat(15));
      fs.writeFileSync(path.join(ctx.workdir, 'error.log'), 'línea\n'.repeat(5));
      fs.writeFileSync(path.join(ctx.workdir, 'access.log'), 'línea\n'.repeat(20));
    },
    async check(ctx) {
      const out = readFile(ctx.workdir, 'summary.txt');
      if (!out) return { pass: false, detail: 'summary.txt no existe' };
      const has15 = /app\.log.*15|15.*app\.log/.test(out);
      const has5 = /error\.log.*5\b|5\b.*error\.log/.test(out);
      const has20 = /access\.log.*20|20.*access\.log/.test(out);
      const pass = has15 && has5 && has20;
      return { pass, detail: pass ? 'summary.txt correcto (15/5/20)' : `contenido: "${out.slice(0, 150)}"` };
    },
    limits: { maxIterations: 10 },
  },

  // ── Generación de código / funciones combinadas ───────────────────────────

  {
    id: 'code-isEmail',
    category: 'coding',
    prompt:
      'Crea validator.js en el directorio actual que exporte isEmail(s) → boolean. ' +
      'Válido = contiene "@", tiene al menos un punto después del "@" y no hay espacios.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {isEmail}=require('./validator.js');" +
        "if(!isEmail('test@example.com'))process.exit(1);" +
        "if(!isEmail('a.b+c@x.org'))process.exit(1);" +
        "if(isEmail('notanemail'))process.exit(1);" +
        "if(isEmail('bad@'))process.exit(1);" +
        "if(isEmail('spa ce@x.com'))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'isEmail válido e inválido ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-wordfreq',
    category: 'coding',
    prompt:
      'Crea wordfreq.js en el directorio actual que exporte wordFreq(text) → objeto ' +
      '{palabra: frecuencia} ignorando mayúsculas (todas las claves en minúsculas).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {wordFreq}=require('./wordfreq.js');" +
        "const r=wordFreq('Hello world hello WORLD foo');" +
        "if(r.hello!==2||r.world!==2||r.foo!==1)process.exit(1);" +
        "if(Object.keys(r).some(k=>k!==k.toLowerCase()))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'wordFreq con normalización de mayúsculas ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-binsearch',
    category: 'coding',
    prompt:
      'Crea binsearch.js en el directorio actual que exporte binarySearch(sortedArr, target) ' +
      '→ índice del elemento en el array ordenado, o -1 si no existe.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {binarySearch}=require('./binsearch.js');" +
        "const a=[1,3,5,7,9,11];" +
        "if(binarySearch(a,7)!==3)process.exit(1);" +
        "if(binarySearch(a,4)!==-1)process.exit(1);" +
        "if(binarySearch(a,1)!==0)process.exit(1);" +
        "if(binarySearch(a,11)!==5)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'binarySearch encuentra y devuelve -1 ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-range',
    category: 'coding',
    prompt:
      'Crea range.js en el directorio actual que exporte range(start, end, step=1) → array ' +
      'de números desde start (incluido) hasta end (excluido) con incremento step.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {range}=require('./range.js');" +
        "if(JSON.stringify(range(0,5))!==JSON.stringify([0,1,2,3,4]))process.exit(1);" +
        "if(JSON.stringify(range(0,10,2))!==JSON.stringify([0,2,4,6,8]))process.exit(1);" +
        "if(JSON.stringify(range(1,4))!==JSON.stringify([1,2,3]))process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'range(0,5), range(0,10,2), range(1,4) ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'code-pipe',
    category: 'coding',
    prompt:
      'Crea pipe.js en el directorio actual que exporte pipe(...fns) → función que ' +
      'aplique las funciones de izquierda a derecha (composición funcional).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {pipe}=require('./pipe.js');" +
        "const double=x=>x*2;const addOne=x=>x+1;const square=x=>x*x;" +
        "const t=pipe(double,addOne);if(t(3)!==7||t(0)!==1)process.exit(1);" +
        "const t2=pipe(addOne,square);if(t2(3)!==16||t2(0)!==1)process.exit(1)",
      );
      return { pass: r.ok, detail: r.ok ? 'pipe(double,addOne) y pipe(addOne,square) ok' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

];
