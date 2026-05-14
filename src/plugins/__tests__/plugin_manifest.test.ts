import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  satisfiesSemverRange,
  SUPPORTED_CAPABILITIES,
  CURRENT_SCHEMA_VERSION,
  CURRENT_SDK_VERSION,
} from '../plugin_manifest.js';

function validInput() {
  return {
    schemaVersion: '1.0',
    name: 'shinobi-plugin-slack',
    version: '0.1.0',
    description: 'Slack channel for Shinobi.',
    author: 'me@example.com',
    entry: './index.js',
    capabilities: ['channel'],
    sdkVersion: '>=1.0.0',
  };
}

describe('satisfiesSemverRange', () => {
  it('exact match', () => {
    expect(satisfiesSemverRange('1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesSemverRange('=1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesSemverRange('1.0.0', '1.0.1')).toBe(false);
  });
  it('>= y >', () => {
    expect(satisfiesSemverRange('>=1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesSemverRange('>=1.0.0', '0.9.9')).toBe(false);
    expect(satisfiesSemverRange('>1.0.0', '1.0.0')).toBe(false);
    expect(satisfiesSemverRange('>1.0.0', '1.0.1')).toBe(true);
  });
  it('<= y <', () => {
    expect(satisfiesSemverRange('<=1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesSemverRange('<=1.0.0', '1.0.1')).toBe(false);
    expect(satisfiesSemverRange('<2.0.0', '1.9.9')).toBe(true);
  });
  it('^caret', () => {
    expect(satisfiesSemverRange('^1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesSemverRange('^1.2.3', '1.9.0')).toBe(true);
    expect(satisfiesSemverRange('^1.2.3', '2.0.0')).toBe(false);
    expect(satisfiesSemverRange('^1.2.3', '1.2.0')).toBe(false);
  });
  it('~tilde', () => {
    expect(satisfiesSemverRange('~1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesSemverRange('~1.2.3', '1.2.9')).toBe(true);
    expect(satisfiesSemverRange('~1.2.3', '1.3.0')).toBe(false);
  });
  it('rangos malformados → false', () => {
    expect(satisfiesSemverRange('', '1.0.0')).toBe(false);
    expect(satisfiesSemverRange('not-a-range', '1.0.0')).toBe(false);
  });
});

describe('validateManifest — happy path', () => {
  it('manifest válido pasa', () => {
    const r = validateManifest(validInput());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.manifest?.name).toBe('shinobi-plugin-slack');
  });
  it('author opcional', () => {
    const m = validInput();
    delete (m as any).author;
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
  });
});

describe('validateManifest — rechazos', () => {
  it('no es objeto', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest('foo').ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
  it('schemaVersion incorrecta', () => {
    const m = validInput(); m.schemaVersion = '2.0';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('schemaVersion'))).toBe(true);
  });
  it('name no matchea prefijo', () => {
    const m = validInput(); m.name = 'random-name';
    expect(validateManifest(m).ok).toBe(false);
  });
  it('version no es semver', () => {
    const m = validInput(); m.version = '1.0';
    expect(validateManifest(m).ok).toBe(false);
  });
  it('description demasiado corta', () => {
    const m = validInput(); m.description = 'x';
    expect(validateManifest(m).ok).toBe(false);
  });
  it('entry no relativo', () => {
    const m = validInput(); m.entry = '/abs/path/index.js';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('entry'))).toBe(true);
  });
  it('capabilities vacío', () => {
    const m = validInput(); m.capabilities = [];
    expect(validateManifest(m).ok).toBe(false);
  });
  it('capability desconocida', () => {
    const m = validInput(); m.capabilities = ['evil' as any];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('"evil"'))).toBe(true);
  });
  it('sdkVersion incompatible', () => {
    const m = validInput(); m.sdkVersion = '>=99.0.0';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('incompatible'))).toBe(true);
  });
  it('sdkVersion malformado', () => {
    const m = validInput(); m.sdkVersion = 'foo';
    expect(validateManifest(m).ok).toBe(false);
  });
  it('author del tipo equivocado', () => {
    const m = validInput(); (m as any).author = 123;
    expect(validateManifest(m).ok).toBe(false);
  });
});

describe('constants', () => {
  it('SUPPORTED_CAPABILITIES lista los 4 esperados', () => {
    expect(SUPPORTED_CAPABILITIES).toEqual(['tool', 'channel', 'provider', 'memory']);
  });
  it('CURRENT_SCHEMA_VERSION y CURRENT_SDK_VERSION definidos', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('1.0');
    expect(CURRENT_SDK_VERSION).toBe('1.0.0');
  });
});
