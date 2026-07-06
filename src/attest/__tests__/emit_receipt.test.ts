// P2.E5 — emisión del Recibo de Misión al cierre. End-to-end: el monitor recoge los
// efectos (recordMissionEffect), y al cerrar la misión emitMissionReceipt construye,
// firma y persiste un recibo que verifica con solo la pública. Requiere el runtime
// (device_identity/audit_chain), así que corre en la suite canónica (vitest/Windows).
import { describe, it, expect } from 'vitest';
import { runWithMandate, recordMissionEffect } from '../../sandbox/mandate.js';
import { emitMissionReceipt } from '../emit_receipt.js';
import { verifyMissionReceipt } from '../mission_receipt.js';
import { _resetDeviceIdentity } from '../device_identity.js';
import { mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('P2.E5 — emisión del recibo al cierre de misión', () => {
  it('recoge efectos, emite recibo firmado que verifica, y lo persiste', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinobi_rec_'));
    process.env.SHINOBI_RECEIPTS_DIR = dir;
    process.env.SHINOBI_DEVICE_KEY_PATH = join(dir, 'device_key.json');
    _resetDeviceIdentity();
    try {
      const mandate = { capabilities: ['shell:/ws'] };
      const receipt = await runWithMandate(mandate, async () => {
        recordMissionEffect({ kind: 'shell', scope: '/ws', decision: 'allow' });
        recordMissionEffect({ kind: 'net', scope: 'blocked', decision: 'deny' });
        return emitMissionReceipt({ missionId: 'test-mission', mandate });
      });
      expect(receipt).not.toBeNull();
      expect(receipt!.effects).toHaveLength(2);
      expect(verifyMissionReceipt(receipt!)).toEqual({ valid: true, reason: 'ok' });
      expect(readdirSync(dir).some((f) => f.startsWith('test-mission'))).toBe(true);
    } finally {
      delete process.env.SHINOBI_RECEIPTS_DIR;
      delete process.env.SHINOBI_DEVICE_KEY_PATH;
      _resetDeviceIdentity();
    }
  });

  it('P4 auto-derive — persiste, aparte del recibo, la propuesta mínima (descarta DENY)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinobi_prop_'));
    process.env.SHINOBI_RECEIPTS_DIR = dir;
    process.env.SHINOBI_DEVICE_KEY_PATH = join(dir, 'device_key.json');
    _resetDeviceIdentity();
    try {
      const mandate = { capabilities: ['shell:/ws', 'net:allowed'] }; // se concedió de más
      await runWithMandate(mandate, async () => {
        recordMissionEffect({ kind: 'shell', scope: '/ws', decision: 'allow' });
        recordMissionEffect({ kind: 'net', scope: 'blocked', decision: 'deny' });
        return emitMissionReceipt({ missionId: 'm2', mandate });
      });
      const pf = readdirSync(dir).find((f) => f.includes('proposed-mandate'));
      expect(pf).toBeDefined();
      const proposed = JSON.parse(readFileSync(join(dir, pf!), 'utf-8'));
      // solo se usó shell:/ws; el net denegado no cuenta; net:allowed concedido pero no usado
      expect(proposed.proposedMinimal).toEqual(['shell:/ws']);
      expect(proposed.granted).toEqual(['shell:/ws', 'net:allowed']);
    } finally {
      delete process.env.SHINOBI_RECEIPTS_DIR;
      delete process.env.SHINOBI_DEVICE_KEY_PATH;
      _resetDeviceIdentity();
    }
  });

  it('fuera de una misión con mandato ⇒ null (no emite)', () => {
    expect(emitMissionReceipt({ missionId: 'x', mandate: { capabilities: [] } })).toBeNull();
  });
});
