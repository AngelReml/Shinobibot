// P2.E5 — emisión del Recibo de Misión al cerrar la misión.
//
// Toma los efectos que el monitor recogió durante la misión (`currentMissionEffects`),
// los empaqueta con el mandato en un Recibo firmado (`buildMissionReceipt` + la
// identidad de dispositivo) y lo persiste como artefacto verificable por terceros.
// Best-effort total: un fallo de recibo JAMÁS tumba la misión. Solo se invoca cuando
// hay mandato activo (E3.b, default-off) — sin `SHINOBI_MANDATE`, ni se llega aquí.
//
// P4 (auto-derive): junto al recibo se persiste, best-effort y en fichero APARTE (sin
// tocar el recibo firmado), la PROPUESTA de mandato mínimo que los efectos permitidos
// de ESTA misión habrían necesitado — el feedback de least-privilege «se te concedió M,
// solo necesitabas M'». Proponer ≠ adoptar (adopción = human-gated).

import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { currentMissionEffects, type Mandate } from '../sandbox/mandate.js';
import { getDeviceIdentity } from './device_identity.js';
import { buildMissionReceipt, type MissionReceipt } from './mission_receipt.js';
import { proposeMandateFromExecuted } from '../policy/derive.js';

function receiptsDir(): string {
  if (process.env.SHINOBI_RECEIPTS_DIR) return resolve(process.env.SHINOBI_RECEIPTS_DIR);
  return join(process.cwd(), '.shinobi', 'receipts');
}

function safeName(s: string): string {
  return (s || 'mission').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 96) || 'mission';
}

/**
 * Construye, firma y persiste el Recibo de Misión con los efectos de la misión activa.
 * Devuelve el recibo emitido, o `null` si no había misión con mandato o algo falló.
 */
export function emitMissionReceipt(opts: {
  missionId: string;
  mandate: Mandate;
  models?: string[];
  auditText?: string;
}): MissionReceipt | null {
  try {
    const effects = currentMissionEffects();
    if (!effects) return null;
    const id = getDeviceIdentity();
    const receipt = buildMissionReceipt({
      missionId: opts.missionId,
      mandate: opts.mandate,
      effects: [...effects],
      models: opts.models ?? [],
      auditText: opts.auditText,
      privateKeyPem: id.privateKeyPem,
      publicKeyPem: id.publicKeyPem,
    });
    try {
      const dir = receiptsDir();
      mkdirSync(dir, { recursive: true });
      const base = `${safeName(opts.missionId)}-${Date.now()}`;
      writeFileSync(join(dir, `${base}.json`), JSON.stringify(receipt, null, 2), { encoding: 'utf-8', mode: 0o600 });
      // P4 auto-derive — propuesta least-privilege, fichero APARTE, best-effort.
      try {
        const proposed = proposeMandateFromExecuted([...effects]);
        writeFileSync(
          join(dir, `${base}-proposed-mandate.json`),
          JSON.stringify({ missionId: opts.missionId, granted: opts.mandate.capabilities, proposedMinimal: proposed.capabilities }, null, 2),
          { encoding: 'utf-8', mode: 0o600 },
        );
      } catch {
        /* la propuesta es un extra: su fallo jamás afecta al recibo */
      }
    } catch {
      /* persistencia best-effort: el recibo se devolvió igual para quien lo quiera */
    }
    return receipt;
  } catch {
    return null;
  }
}
