/**
 * Tests puros del tool pack Windows-elite.
 *
 * Solo lógica que NO ejecuta procesos externos (PowerShell, schtasks).
 * La verificación E2E queda en `scratch/gates_tool_pack.ts` para no
 * disparar comandos del sistema en CI.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeXmlText } from '../windows_notification.js';
import { isAllowedRegistryPath } from '../registry_read.js';
import { isValidTaskName } from '../task_scheduler_create.js';
import { psEscapeString, psLit } from '../_powershell.js';

describe('sanitizeXmlText', () => {
  it('escapa <>&"\'', () => {
    expect(sanitizeXmlText('<script>')).toBe('&lt;script&gt;');
    expect(sanitizeXmlText('foo & bar')).toBe('foo &amp; bar');
    expect(sanitizeXmlText("o'r")).toBe('o&apos;r');
    expect(sanitizeXmlText('a"b')).toBe('a&quot;b');
  });
});

describe('isAllowedRegistryPath', () => {
  it('acepta hives whitelisted', () => {
    expect(isAllowedRegistryPath('HKLM:\\SOFTWARE').ok).toBe(true);
    expect(isAllowedRegistryPath('hkcu:\\Software').ok).toBe(true);
    expect(isAllowedRegistryPath('HKCR:').ok).toBe(true);
  });
  it('rechaza filesystem y comillas', () => {
    expect(isAllowedRegistryPath('C:\\Windows').ok).toBe(false);
    expect(isAllowedRegistryPath('').ok).toBe(false);
    expect(isAllowedRegistryPath('HKLM:\\foo"bar').ok).toBe(false);
    expect(isAllowedRegistryPath("HKLM:\\foo'bar").ok).toBe(false);
    expect(isAllowedRegistryPath('FAKE:\\X').ok).toBe(false);
  });
});

describe('isValidTaskName', () => {
  it('acepta nombres legítimos', () => {
    expect(isValidTaskName('My Task')).toBe(true);
    expect(isValidTaskName('shinobi-cron_1')).toBe(true);
  });
  it('rechaza inválidos', () => {
    expect(isValidTaskName('')).toBe(false);
    expect(isValidTaskName('bad;cmd')).toBe(false);
    expect(isValidTaskName('a'.repeat(129))).toBe(false);
    expect(isValidTaskName('with"quote')).toBe(false);
    expect(isValidTaskName('with`tick')).toBe(false);
  });
});

describe('psEscapeString / psLit', () => {
  it('duplica single quotes', () => {
    expect(psEscapeString("o'reilly")).toBe("o''reilly");
  });
  it('psLit envuelve en single quotes', () => {
    expect(psLit('hello')).toBe("'hello'");
    expect(psLit("a'b")).toBe("'a''b'");
  });
});
