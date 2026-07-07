import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveTerritory, registerCapability, getManifest, getTerritory,
  listSources, clearRegistry, seedKnownSources,
} from '../registry.js';
import type { DojoManifest } from '../types.js';

describe('deriveTerritory (candado, §11)', () => {
  it('shell arbitrario ⇒ destruccion', () => {
    expect(deriveTerritory(['shell:*'])).toBe('destruccion');
  });
  it('scope de secreto ⇒ secretos', () => {
    expect(deriveTerritory(['fs.read:.ssh/id_rsa'])).toBe('secretos');
    expect(deriveTerritory(['fs.write:config/.env'])).toBe('secretos');
  });
  it('secretos gana a destruccion', () => {
    expect(deriveTerritory(['shell:rm', 'fs.read:secrets/token'])).toBe('secretos');
  });
  it('lectura ordinaria y red ⇒ ninguno', () => {
    expect(deriveTerritory(['fs.read:reports/', 'net:arxiv.org'])).toBe('ninguno');
  });
  it('capacidad malformada se ignora ⇒ ninguno', () => {
    expect(deriveTerritory(['no-es-capacidad', 'fs.read'])).toBe('ninguno');
  });
});

describe('registro abierto (sustituye al enum)', () => {
  beforeEach(() => clearRegistry());

  it('registra y lista una capacidad con id NUEVO, sin tocar enums', () => {
    const m: DojoManifest = {
      id: 'nueva-capacidad', nombre: 'Nueva', hace: 'algo', zona: 'VER',
      emite: ['action'], estado: 'forja',
    };
    registerCapability(m, ['fs.write:secrets/x']);
    expect(getManifest('nueva-capacidad')?.nombre).toBe('Nueva');
    expect(getTerritory('nueva-capacidad')).toBe('secretos');   // el candado lo verá
    expect(listSources()).toContain('nueva-capacidad');
  });

  it('la semilla registra las 6 fuentes que vivían en el enum', () => {
    seedKnownSources();
    expect(listSources()).toHaveLength(6);
    expect(getManifest('kagemusha')?.zona).toBe('CONDUCIR');
    expect(getTerritory('kagemusha')).toBe('ninguno');          // semilla conservadora
  });
});
