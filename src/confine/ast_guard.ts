// P3 (Runtime de Confinamiento Unificado) — guard por AST del código foráneo.
//
// El auditor de skills (`skills/auditor`) usa ~90 regex; la auditoría lo marca como
// "trivialmente evadible con ofuscación mínima" (`globalThis['pro'+'cess']`,
// base64→eval). Este guard razona sobre la ESTRUCTURA del programa (AST del compilador
// de TypeScript, ya presente en el repo), no sobre su texto, así que no se engaña con
// concatenaciones ni accesos computados. Corre en paralelo al auditor regex (shadow) y
// es la base del loader unificado del Pilar 3. Puro y fail-closed (código no parseable
// ⇒ no seguro).

import * as ts from 'typescript';

/** Nombres cuyo uso en código foráneo es señal de escape del confinamiento. */
const FORBIDDEN_NAMES = new Set([
  'process', 'require', 'eval', 'Function', 'child_process', 'globalThis', 'Reflect', 'WebAssembly', 'Proxy',
]);

export interface AstScanResult {
  readonly safe: boolean;
  readonly findings: string[];
}

/**
 * Escanea código foráneo por patrones de escape. Detecta, entre otros:
 *   - identificadores prohibidos (`process`, `eval`, `Function`, `require`, `child_process`,
 *     `globalThis`, `Reflect`…),
 *   - acceso a miembro COMPUTADO por string/concatenación/template (`x['pro'+'cess']`),
 *   - `import()` dinámico.
 * `safe` solo si no hay hallazgos. Fail-closed: si el código no parsea, no es seguro.
 */
export function scanForbidden(code: string): AstScanResult {
  const findings: string[] = [];
  const add = (m: string) => { if (!findings.includes(m)) findings.push(m); };
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile('foreign.ts', code, ts.ScriptTarget.Latest, true);
  } catch {
    return { safe: false, findings: ['código no parseable (fail-closed)'] };
  }
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text)) {
      const parent = node.parent;
      // No contar cuando es el NOMBRE de una propiedad (`obj.process` definido por el
      // propio código) — solo el acceso/uso del binding global cuenta.
      const isPropName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropName) add(`identificador prohibido: ${node.text}`);
    }
    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (arg && (ts.isStringLiteralLike(arg) || ts.isBinaryExpression(arg) || ts.isTemplateExpression(arg))) {
        add('acceso a miembro computado por string (posible ofuscación)');
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add('import() dinámico');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { safe: findings.length === 0, findings };
}
