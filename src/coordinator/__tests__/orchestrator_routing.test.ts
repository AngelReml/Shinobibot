import { describe, it, expect, afterEach } from 'vitest';
import { ShinobiOrchestrator } from '../orchestrator.js';

// El slash command `/tier` y `/model` invocaban getTier/setTier en el
// orchestrator. Antes esos métodos no existían y el `?.` los tragaba en
// silencio (el comando mentía al usuario). Ahora existen y se cablean al
// model router — este test verifica el contrato.
describe('ShinobiOrchestrator tier/model API', () => {
  afterEach(() => {
    ShinobiOrchestrator.setTier(undefined);
    ShinobiOrchestrator.setModel(undefined);
  });

  it('getTier por defecto es auto', () => {
    expect(ShinobiOrchestrator.getTier()).toBe('auto');
  });

  it('setTier/getTier hacen round-trip', () => {
    ShinobiOrchestrator.setTier('REASONING');
    expect(ShinobiOrchestrator.getTier()).toBe('REASONING');
    ShinobiOrchestrator.setTier('FAST');
    expect(ShinobiOrchestrator.getTier()).toBe('FAST');
    ShinobiOrchestrator.setTier(undefined);
    expect(ShinobiOrchestrator.getTier()).toBe('auto');
  });

  it('setModel/getModel hacen round-trip', () => {
    ShinobiOrchestrator.setModel('anthropic/claude-haiku-4.5');
    expect(ShinobiOrchestrator.getModel()).toBe('anthropic/claude-haiku-4.5');
    ShinobiOrchestrator.setModel(undefined);
    expect(ShinobiOrchestrator.getModel()).toBe('default');
  });
});
