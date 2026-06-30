// S-SWE v1.0 — benchmark de localización de código + fix estilo SWE-bench (G4).
//
// Tesis: el cuello de botella de SWE-bench no es escribir código — es encontrar
// el archivo/función correcto entre decenas de ficheros. Estas tareas miden exactamente
// eso: dado un repo-stub en el workdir, el agente debe localizar y corregir el bug.
// Check DETERMINISTA: Node.js ejecuta el archivo corregido sin LLM.
//
// Categorías:
//   swe-locate  — encontrar el archivo correcto entre varios (localización)
//   swe-repro   — escribir primero el test que reproduce el bug (reproduction-first)
//   swe-fix     — reparar un bug concreto ya localizado (fix puro)
//
// Versión congelada (G4): no se edita entre corridas. Cambio = v1.1.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BenchTask } from '../types.js';

export const S_SWE_VERSION = 'v1.0';

// ── Helpers ──────────────────────────────────────────────────────────────────

function nodeCheck(workdir: string, script: string): { ok: boolean; detail: string } {
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: workdir, encoding: 'utf-8', timeout: 15_000,
  });
  return { ok: (r.status ?? 1) === 0, detail: (r.stderr || r.stdout || '').trim().slice(0, 300) };
}

function writeStub(workdir: string, rel: string, content: string): void {
  const full = path.join(workdir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function readFile(workdir: string, rel: string): string | null {
  const p = path.join(workdir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const S_SWE_TASKS: BenchTask[] = [

  // ─────────────────────────── swe-locate ──────────────────────────────────

  {
    id: 'swe-locate-average',
    category: 'swe-locate',
    async setup(ctx) {
      writeStub(ctx.workdir, 'utils/format.js',
        '// format.js — utilidades de presentación\n' +
        'module.exports.formatDate = d => new Date(d).toISOString().slice(0,10);\n');
      writeStub(ctx.workdir, 'utils/math.js',
        '// math.js — cálculos estadísticos\n' +
        'function average(nums) {\n' +
        '  const total = nums.reduce((a,b)=>a+b, 0);\n' +
        '  return total / nums.total; // BUG: debería ser nums.length\n' +
        '}\n' +
        'module.exports = { average };\n');
      writeStub(ctx.workdir, 'utils/string.js',
        '// string.js — manipulación de cadenas\n' +
        'module.exports.capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);\n');
    },
    prompt:
      'El directorio contiene utils/format.js, utils/math.js y utils/string.js. ' +
      'Hay un bug en la función average de uno de esos archivos: divide entre una propiedad inexistente en vez de usar .length. ' +
      'Localiza el archivo con el bug y corrígelo.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {average}=require('./utils/math.js');" +
        "if(average([1,2,3])!==2||average([10,20])!==15||average([5])!==5)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'average([1,2,3])=2, [10,20]=15' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'swe-locate-boundary',
    category: 'swe-locate',
    async setup(ctx) {
      writeStub(ctx.workdir, 'lib/validators.js',
        'module.exports.isEmail = s => s.includes("@");\n' +
        'module.exports.isUrl = s => s.startsWith("http");\n');
      writeStub(ctx.workdir, 'lib/range.js',
        '// Comprueba si n está en [min, max]\n' +
        'function inRange(n, min, max) {\n' +
        '  return n >= min && n < max; // BUG: debería ser n <= max\n' +
        '}\n' +
        'module.exports = { inRange };\n');
      writeStub(ctx.workdir, 'lib/parser.js',
        'module.exports.parseJson = s => { try { return JSON.parse(s); } catch { return null; } };\n');
    },
    prompt:
      'El directorio lib/ contiene validators.js, range.js y parser.js. ' +
      'La función inRange tiene un off-by-one en uno de ellos: el límite superior es exclusivo cuando debería ser inclusivo. ' +
      'Localiza y corrige el bug para que inRange(5, 1, 5) devuelva true.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {inRange}=require('./lib/range.js');" +
        "if(!inRange(5,1,5)||!inRange(1,1,5)||inRange(6,1,5)||inRange(0,1,5))process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'inRange boundary correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'swe-locate-multi-file',
    category: 'swe-locate',
    async setup(ctx) {
      writeStub(ctx.workdir, 'src/auth.js',
        'function hashPassword(pw) { return pw.split("").reverse().join(""); }\n' +
        'module.exports = { hashPassword };\n');
      writeStub(ctx.workdir, 'src/user.js',
        'const { hashPassword } = require("./auth");\n' +
        'function createUser(name, pw) {\n' +
        '  return { name, passwordHash: hashPassword(pw), createdAt: Date.now() };\n' +
        '}\n' +
        'function getDisplayName(user) {\n' +
        '  return user.username; // BUG: debería ser user.name\n' +
        '}\n' +
        'module.exports = { createUser, getDisplayName };\n');
      writeStub(ctx.workdir, 'src/config.js',
        'module.exports = { maxUsers: 100, sessionTimeout: 3600 };\n');
    },
    prompt:
      'El directorio src/ tiene auth.js, user.js y config.js. ' +
      'La función getDisplayName devuelve undefined porque accede a una propiedad con nombre incorrecto. ' +
      'Localiza el archivo con el bug y corrígelo.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {createUser,getDisplayName}=require('./src/user.js');" +
        "const u=createUser('Ana','secret');" +
        "if(getDisplayName(u)!=='Ana')process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'getDisplayName correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  // ─────────────────────────── swe-repro ───────────────────────────────────

  {
    id: 'swe-repro-test-first',
    category: 'swe-repro',
    async setup(ctx) {
      writeStub(ctx.workdir, 'stack.js',
        '// Implementación de pila\n' +
        'class Stack {\n' +
        '  constructor() { this.items = []; }\n' +
        '  push(x) { this.items.push(x); }\n' +
        '  pop() { return this.items.pop(); }\n' +
        '  peek() { return this.items[this.items.length]; } // BUG: debería ser length - 1\n' +
        '  size() { return this.items.length; }\n' +
        '  isEmpty() { return this.items.length === 0; }\n' +
        '}\n' +
        'module.exports = { Stack };\n');
    },
    prompt:
      'El archivo stack.js contiene una implementación de pila (Stack). ' +
      'El método peek() tiene un bug: devuelve undefined en vez del elemento en el tope. ' +
      'Primero crea un archivo test_stack.js que demuestre el fallo (ejecuta process.exit(1) si peek falla). ' +
      'Luego corrige el bug en stack.js.',
    async check(ctx) {
      const testExists = fs.existsSync(path.join(ctx.workdir, 'test_stack.js'));
      const r = nodeCheck(ctx.workdir,
        "const {Stack}=require('./stack.js');" +
        "const s=new Stack();s.push(1);s.push(2);" +
        "if(s.peek()!==2||s.size()!==2)process.exit(1)");
      const detail = !testExists ? 'falta test_stack.js' : r.ok ? 'peek correcto + test existe' : r.detail;
      return { pass: testExists && r.ok, detail };
    },
    limits: { maxIterations: 10 },
  },

  {
    id: 'swe-repro-assertion',
    category: 'swe-repro',
    async setup(ctx) {
      writeStub(ctx.workdir, 'money.js',
        '// Aritmética monetaria con precisión decimal\n' +
        'function addMoney(a, b) {\n' +
        '  // BUG: suma flotante cruda sin redondeo\n' +
        '  return a + b;\n' +
        '}\n' +
        'module.exports = { addMoney };\n');
    },
    prompt:
      'El archivo money.js tiene addMoney(a, b) que sufre errores de punto flotante (0.1 + 0.2 !== 0.3). ' +
      'Primero crea test_money.js que falle con la implementación actual (process.exit(1) si 0.1+0.2 no es 0.3). ' +
      'Luego corrige addMoney para que redondee a 2 decimales (multiplicar×100, redondear, dividir÷100).',
    async check(ctx) {
      const testExists = fs.existsSync(path.join(ctx.workdir, 'test_money.js'));
      const r = nodeCheck(ctx.workdir,
        "const {addMoney}=require('./money.js');" +
        "if(addMoney(0.1,0.2)!==0.3||addMoney(1.005,2.005)!==3.01||addMoney(10,5)!==15)process.exit(1)");
      const detail = !testExists ? 'falta test_money.js' : r.ok ? 'addMoney preciso + test existe' : r.detail;
      return { pass: testExists && r.ok, detail };
    },
    limits: { maxIterations: 10 },
  },

  // ─────────────────────────── swe-fix ─────────────────────────────────────

  {
    id: 'swe-fix-off-by-one',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'slice.js',
        '// Devuelve los últimos n elementos de un array\n' +
        'function lastN(arr, n) {\n' +
        '  return arr.slice(arr.length - n + 1); // BUG: off-by-one, debería ser -n\n' +
        '}\n' +
        'module.exports = { lastN };\n');
    },
    prompt: 'El archivo slice.js tiene lastN(arr, n) que devuelve n-1 elementos en vez de n. Corrígelo.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {lastN}=require('./slice.js');" +
        "const a=[1,2,3,4,5];" +
        "const r3=lastN(a,3);const r1=lastN(a,1);" +
        "if(r3.length!==3||r3[0]!==3||r1[0]!==5)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'lastN correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-null-check',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'safe.js',
        '// Acceso seguro a propiedades\n' +
        'function getNestedValue(obj, key1, key2) {\n' +
        '  return obj[key1][key2]; // BUG: no verifica que obj[key1] exista\n' +
        '}\n' +
        'module.exports = { getNestedValue };\n');
    },
    prompt:
      'El archivo safe.js tiene getNestedValue(obj, key1, key2) que lanza TypeError cuando obj[key1] es undefined. ' +
      'Corrígelo para que devuelva undefined sin lanzar error cuando key1 no existe.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {getNestedValue}=require('./safe.js');" +
        "if(getNestedValue({a:{b:1}},'a','b')!==1)process.exit(1);" +
        "if(getNestedValue({a:{}},'a','x')!==undefined)process.exit(1);" +
        "if(getNestedValue({},'missing','key')!==undefined)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'null-safe correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-logic-operator',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'access.js',
        '// Control de acceso por rol\n' +
        'function canAccess(user) {\n' +
        '  // Solo admin Y activo deben poder acceder, no admin O activo\n' +
        '  return user.role === "admin" || user.active; // BUG: debería ser &&\n' +
        '}\n' +
        'module.exports = { canAccess };\n');
    },
    prompt:
      'El archivo access.js tiene canAccess(user) que permite el acceso a usuarios activos no-admin. ' +
      'El bug: usa || en vez de &&. Solo un admin Y activo debe poder acceder.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {canAccess}=require('./access.js');" +
        "if(!canAccess({role:'admin',active:true}))process.exit(1);" +
        "if(canAccess({role:'admin',active:false}))process.exit(1);" +
        "if(canAccess({role:'user',active:true}))process.exit(1);" +
        "if(canAccess({role:'user',active:false}))process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'canAccess &&-correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-strict-equality',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'compare.js',
        '// Comparaciones de tipo seguro\n' +
        'function isZero(val) { return val == 0; }    // BUG: == coerces "0", false, null\n' +
        'function isTruthy(val) { return val === true; } // correcto\n' +
        'module.exports = { isZero, isTruthy };\n');
    },
    prompt:
      'El archivo compare.js tiene isZero(val) que usa == en vez de ===, causando que isZero("0") y isZero(false) devuelvan true. ' +
      'Corrígelo para usar ===.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {isZero}=require('./compare.js');" +
        "if(!isZero(0))process.exit(1);" +
        "if(isZero('0'))process.exit(1);" +
        "if(isZero(false))process.exit(1);" +
        "if(isZero(null))process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'isZero === correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-accumulator',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'stats.js',
        '// Cálculos estadísticos básicos\n' +
        'function sum(arr) { return arr.reduce((acc, x) => acc + x); } // BUG: sin valor inicial, falla con array vacío\n' +
        'function product(arr) { return arr.reduce((acc, x) => acc * x, 1); } // correcto\n' +
        'module.exports = { sum, product };\n');
    },
    prompt:
      'El archivo stats.js tiene sum(arr) que no pasa valor inicial al reduce, lo que lanza TypeError con un array vacío. ' +
      'Corrígelo añadiendo 0 como valor inicial.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {sum}=require('./stats.js');" +
        "if(sum([])!==0)process.exit(1);" +
        "if(sum([1,2,3])!==6)process.exit(1);" +
        "if(sum([5])!==5)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'sum con initialValue=0 correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-async-missing-await',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'fetcher.js',
        '// Simulación de fetch con Promise\n' +
        'function delay(ms) { return new Promise(r => setTimeout(r, ms)); }\n' +
        'async function fetchData(id) {\n' +
        '  await delay(1);\n' +
        '  return { id, value: id * 10 };\n' +
        '}\n' +
        'async function processAll(ids) {\n' +
        '  const results = ids.map(id => fetchData(id)); // BUG: falta await\n' +
        '  return results.map(r => r.value);\n' +
        '}\n' +
        'module.exports = { processAll };\n');
    },
    prompt:
      'El archivo fetcher.js tiene processAll(ids) que devuelve Promises en vez de valores porque le falta un await en el map. ' +
      'Corrígelo usando Promise.all.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {processAll}=require('./fetcher.js');" +
        "processAll([1,2,3]).then(vs=>{" +
        "  if(!Array.isArray(vs)||vs[0]!==10||vs[1]!==20||vs[2]!==30)process.exit(1);" +
        "}).catch(()=>process.exit(1))");
      return { pass: r.ok, detail: r.ok ? 'Promise.all correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'swe-fix-wrong-default',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'config.js',
        '// Configuración de la aplicación con defaults\n' +
        'const DEFAULT_TIMEOUT = 0;  // BUG: debería ser 5000 ms\n' +
        'const DEFAULT_RETRIES = 3;\n' +
        'function getConfig(overrides = {}) {\n' +
        '  return { timeout: DEFAULT_TIMEOUT, retries: DEFAULT_RETRIES, ...overrides };\n' +
        '}\n' +
        'module.exports = { getConfig, DEFAULT_TIMEOUT, DEFAULT_RETRIES };\n');
    },
    prompt:
      'El archivo config.js usa DEFAULT_TIMEOUT = 0 como valor por defecto. ' +
      'El correcto es 5000 ms. Corrígelo.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {getConfig,DEFAULT_TIMEOUT}=require('./config.js');" +
        "if(DEFAULT_TIMEOUT!==5000)process.exit(1);" +
        "if(getConfig().timeout!==5000)process.exit(1);" +
        "if(getConfig({timeout:1000}).timeout!==1000)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'DEFAULT_TIMEOUT=5000 correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },

  {
    id: 'swe-fix-regex',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'validate.js',
        '// Validación de formatos\n' +
        '// BUG: .* permite usuario vacío ("@domain.com" es aceptado)\n' +
        'function isValidEmail(s) { return /^.*@.+\\..+$/.test(s); }\n' +
        'module.exports = { isValidEmail };\n');
    },
    prompt:
      'El archivo validate.js tiene isValidEmail con /^.*@.../ que acepta "@domain.com" (usuario vacío). ' +
      'Corrígelo cambiando .* por [\\w.-]+ para que el usuario tenga al menos un carácter válido.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {isValidEmail}=require('./validate.js');" +
        "if(!isValidEmail('user@example.com'))process.exit(1);" +
        "if(!isValidEmail('a.b-c@x.io'))process.exit(1);" +
        "if(isValidEmail('@domain.com'))process.exit(1);" +
        "if(isValidEmail('nodomain@'))process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'isValidEmail regex correcto' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'swe-fix-deep-clone',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'clone.js',
        '// Utilidad de copia\n' +
        'function shallowClone(obj) { return Object.assign({}, obj); }\n' +
        'function deepClone(obj) {\n' +
        '  return Object.assign({}, obj); // BUG: esto es shallow, no deep\n' +
        '}\n' +
        'module.exports = { shallowClone, deepClone };\n');
    },
    prompt:
      'El archivo clone.js tiene deepClone(obj) que hace una copia superficial en vez de profunda. ' +
      'Las mutaciones en objetos anidados del clon afectan al original. ' +
      'Corrígelo usando JSON.parse(JSON.stringify(obj)).',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {deepClone}=require('./clone.js');" +
        "const original={a:{b:1},c:2};" +
        "const copy=deepClone(original);" +
        "copy.a.b=99;" +
        "if(original.a.b===99)process.exit(1);" +
        "if(copy.c!==2)process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'deepClone independiente' : r.detail };
    },
    limits: { maxIterations: 8 },
  },

  {
    id: 'swe-fix-sort-numeric',
    category: 'swe-fix',
    async setup(ctx) {
      writeStub(ctx.workdir, 'sorter.js',
        '// Ordenación de datos\n' +
        'function sortNumbers(arr) {\n' +
        '  return [...arr].sort(); // BUG: sort() sin comparador ordena lexicográficamente\n' +
        '}\n' +
        'module.exports = { sortNumbers };\n');
    },
    prompt:
      'El archivo sorter.js tiene sortNumbers que devuelve [1, 10, 2] porque usa sort() sin comparador numérico. ' +
      'Corrígelo pasando (a,b) => a - b.',
    async check(ctx) {
      const r = nodeCheck(ctx.workdir,
        "const {sortNumbers}=require('./sorter.js');" +
        "const r=sortNumbers([10,1,20,2,15]);" +
        "if(r.join(',')!=='1,2,10,15,20')process.exit(1)");
      return { pass: r.ok, detail: r.ok ? 'sortNumbers numérico correcto' : r.detail };
    },
    limits: { maxIterations: 6 },
  },
];
