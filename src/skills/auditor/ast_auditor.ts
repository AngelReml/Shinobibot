/**
 * AST auditor - walk real de TypeScript/JavaScript sobre el codigo de una
 * skill (.mjs/.js/.ts), como CAPA 2 del auditor junto a la regex de
 * skill_auditor.ts (capa 1).
 *
 * Detecta acceso a process/require/import dinamico/eval/new Function/
 * child_process y modulos node fuera de la superficie declarada, incluso
 * ofuscados via concatenacion de strings, String.fromCharCode, o variables
 * intermedias -- porque analiza la FORMA sintactica (AST), no el texto.
 *
 * NO reemplaza la capa regex (permanece activa). Ambas capas son
 * independientes y cada una atrapa lo que la otra puede perderse.
 */

import * as ts from 'typescript';
import type { AuditFinding, AuditVerdict } from '../skill_auditor.js';

const DANGEROUS_GLOBAL_IDENTIFIERS = new Set(['process', 'require']);
const DANGEROUS_MODULES = new Set([
  'child_process', 'node:child_process',
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'net', 'node:net', 'dgram', 'node:dgram', 'tls', 'node:tls',
  'os', 'node:os', 'vm', 'node:vm', 'worker_threads', 'node:worker_threads',
  'cluster', 'node:cluster',
]);

export interface AstFinding extends AuditFinding {}

interface WalkCtx {
  sourceFile: ts.SourceFile;
  filePath: string;
  out: AstFinding[];
}

function line(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function push(ctx: WalkCtx, level: AuditVerdict, rule: string, node: ts.Node, reason: string): void {
  const snippet = node.getText(ctx.sourceFile).slice(0, 120);
  ctx.out.push({
    level,
    rule,
    file: ctx.filePath,
    line: line(ctx.sourceFile, node.getStart(ctx.sourceFile)),
    snippet,
    reason,
  });
}

function staticStringValue(node: ts.Expression, sourceFile?: ts.SourceFile, seen: Set<ts.Node> = new Set()): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = staticStringValue(node.left, sourceFile, seen);
    const r = staticStringValue(node.right, sourceFile, seen);
    if (l !== undefined && r !== undefined) return l + r;
    return undefined;
  }
  if (ts.isParenthesizedExpression(node)) return staticStringValue(node.expression, sourceFile, seen);
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) {
    return node.head.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'fromCharCode' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'String'
  ) {
    const codes: number[] = [];
    for (const arg of node.arguments) {
      if (ts.isNumericLiteral(arg)) codes.push(Number(arg.text));
      else return undefined;
    }
    try { return String.fromCharCode(...codes); } catch { return undefined; }
  }
  if (ts.isIdentifier(node) && sourceFile && !seen.has(node)) {
    seen.add(node);
    const decl = findConstDeclaration(sourceFile, node.text);
    if (decl && decl.initializer) return staticStringValue(decl.initializer, sourceFile, seen);
  }
  return undefined;
}

function findConstDeclaration(sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return found;
}

function isGlobalObjectRef(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && ['globalThis', 'global', 'self', 'window'].includes(node.text);
}

function walkNode(node: ts.Node, ctx: WalkCtx): void {
  if (node.kind === ts.SyntaxKind.ImportKeyword && node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
    push(ctx, 'critical', 'ast-dynamic-import', node.parent, 'import() dinamico -- puede cargar codigo arbitrario en runtime');
  }

  if (ts.isCallExpression(node)) {
    const callee = node.expression;

    if (ts.isIdentifier(callee) && callee.text === 'eval') {
      push(ctx, 'critical', 'ast-eval-call', node, 'llamada a eval() -- ejecucion de codigo arbitrario');
    }

    if (ts.isIdentifier(callee) && callee.text === 'require') {
      const arg = node.arguments[0];
      const modName = arg ? staticStringValue(arg, ctx.sourceFile) : undefined;
      if (modName && DANGEROUS_MODULES.has(modName)) {
        push(ctx, 'critical', 'ast-require-dangerous-module', node, `require('${modName}') -- modulo fuera de la API declarada de la skill`);
      } else {
        push(ctx, 'warning', 'ast-require-call', node, 'require() dinamico dentro de la skill');
      }
    }

    if (ts.isElementAccessExpression(callee) && isGlobalObjectRef(callee.expression)) {
      const key = staticStringValue(callee.argumentExpression, ctx.sourceFile);
      if (key && DANGEROUS_GLOBAL_IDENTIFIERS.has(key)) {
        push(ctx, 'critical', 'ast-obfuscated-global-call', node, `acceso ofuscado a globalThis['${key}'](...) -- evasion de deteccion textual`);
      }
    }

    if (ts.isIdentifier(callee) && callee.text === 'Function') {
      push(ctx, 'critical', 'ast-function-constructor-call', node, 'Function(...) invocado como constructor sin new -- construye codigo desde strings');
    }
  }

  if (ts.isNewExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === 'Function') {
      push(ctx, 'critical', 'ast-new-function', node, 'new Function(...) -- compila codigo arbitrario desde strings en runtime');
    }
  }

  if (ts.isIdentifier(node) && node.text === 'process') {
    const parent = node.parent;
    const isPropertyNamePosition = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
    if (!isPropertyNamePosition) {
      push(ctx, 'critical', 'ast-process-access', node, 'acceso directo al identificador global process -- superficie completa del proceso host');
    }
  }
  if (ts.isPropertyAccessExpression(node) && isGlobalObjectRef(node.expression) && node.name.text === 'process') {
    push(ctx, 'critical', 'ast-globalthis-process', node, 'acceso a globalThis.process -- superficie completa del proceso host');
  }
  if (ts.isElementAccessExpression(node) && isGlobalObjectRef(node.expression)) {
    const key = staticStringValue(node.argumentExpression, ctx.sourceFile);
    if (key === 'process') {
      push(ctx, 'critical', 'ast-obfuscated-global-process', node, `acceso ofuscado a globalThis['process'] (construido: "${key}") -- evasion de deteccion textual`);
    } else if (key === 'require') {
      push(ctx, 'critical', 'ast-obfuscated-global-call', node, `acceso ofuscado a globalThis['require'] (construido: "${key}") -- evasion de deteccion textual`);
    }
  }

  if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
    const mod = node.moduleSpecifier.text;
    if (DANGEROUS_MODULES.has(mod)) {
      push(ctx, 'critical', 'ast-import-dangerous-module', node, `import de '${mod}' -- modulo fuera de la API declarada de la skill`);
    }
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const val = staticStringValue(node);
    if (val && (DANGEROUS_GLOBAL_IDENTIFIERS.has(val) || DANGEROUS_MODULES.has(val) || val === 'child_process')) {
      const parentIsPlusBinary = node.parent && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
      if (!parentIsPlusBinary) {
        push(ctx, 'warning', 'ast-string-concat-identifier', node, `concatenacion de strings compone el identificador sensible "${val}" -- patron de ofuscacion`);
      }
    }
  }

  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === 'atob') {
      push(ctx, 'warning', 'ast-atob-decode', node, 'atob() decodifica base64 -- combinado con eval/Function es un payload ofuscado clasico');
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'from' &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'Buffer' &&
      node.arguments.some((a) => staticStringValue(a) === 'base64')
    ) {
      push(ctx, 'warning', 'ast-buffer-base64-decode', node, "Buffer.from(..., 'base64') -- decodificacion que puede ocultar un payload");
    }
  }

  ts.forEachChild(node, (child) => walkNode(child, ctx));
}

export function scanAst(content: string, filePath: string): AstFinding[] {
  const out: AstFinding[] = [];
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );
  } catch (e: any) {
    return [{
      level: 'warning',
      rule: 'ast-parse-failed',
      file: filePath,
      snippet: String(e?.message ?? e).slice(0, 120),
      reason: 'el parser AST no pudo analizar el archivo -- solo cubierto por la capa regex',
    }];
  }
  const ctx: WalkCtx = { sourceFile, filePath, out };
  walkNode(sourceFile, ctx);
  return out;
}

export function isAstScannable(filePath: string): boolean {
  return /\.(m?js|cjs|ts|tsx)$/i.test(filePath);
}
