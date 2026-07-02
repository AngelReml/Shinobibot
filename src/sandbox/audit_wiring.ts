// P1 (Monitor de Referencia) — glue entre el monitor y la capa de audit.
//
// El monitor (`monitor.ts`) NO conoce el audit: expone un SINK genérico
// (`setEffectAuditSink`) con default no-op. Este módulo es el único que conecta
// ese sink con `writeAuditEvent`/`logEffect`. Separación deliberada:
//   - `monitor.ts` queda desacoplado y testeable sin tocar disco.
//   - los TESTS no importan este módulo ⇒ el sink nunca se instala ⇒ cero cruft.
//   - el ARRANQUE real (scripts/shinobi*.ts) llama `installEffectAudit()` una vez
//     ⇒ a partir de ahí todo efecto mediado se audita (redactado, hash-chained,
//     fail-open). Cierra el hueco de observabilidad de shugyo/kaname/shitsuji/
//     chizu/kagami, cuyas ejecuciones antes esquivaban el audit de run_command.
//
// Idempotente y reversible: llamar dos veces reinstala el mismo sink; pasar
// `false` lo desinstala (útil en un shutdown ordenado o en pruebas manuales).

import { setEffectAuditSink } from './monitor.js';
import { logEffect } from '../audit/audit_log.js';

/**
 * Instala el sink de audit de efectos del monitor. Llamar una vez al arrancar.
 * @param enable  `false` desinstala el sink (vuelve al no-op por defecto).
 */
export function installEffectAudit(enable = true): void {
  if (!enable) {
    setEffectAuditSink(null);
    return;
  }
  setEffectAuditSink((record) => {
    // `logEffect` es best-effort/fail-open; aun así lo envolvemos para que un
    // error inesperado jamás escape hacia el monitor (que ya nos llama en
    // try/catch, pero la defensa en profundidad es barata).
    try {
      logEffect({
        effectKind: record.kind,
        backendId: record.backendId,
        targetPreview: record.targetPreview,
        reversible: record.reversible,
        decision: record.decision,
        code: record.code,
        success: record.success,
        durationMs: record.durationMs,
      });
    } catch {
      /* fail-open */
    }
  });
}
