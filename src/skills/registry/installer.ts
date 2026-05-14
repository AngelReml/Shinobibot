/**
 * Skill registry installer — `shinobi skill install <name>` resuelve el
 * nombre contra el registry, baja el bundle, audita+firma, e instala
 * en `<skillsRoot>/approved/<name>@<version>/`. Sprint 2.5.
 *
 * Rollback: cada install hace backup del directorio anterior (si
 * existe) en `<skillsRoot>/.rollback/<name>/<oldVersion>/`. `rollback`
 * mueve el backup de vuelta y elimina la versión nueva.
 *
 * Estructura `<skillsRoot>/`:
 *   approved/
 *     <name>@<version>/         ← versión activa
 *   .rollback/
 *     <name>/<oldVersion>/      ← snapshot pre-instalación
 *   installed.json              ← inventario {name → version}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, renameSync, cpSync } from 'fs';
import { join } from 'path';
import type { SkillRegistry, SkillManifestEntry } from './types.js';
import { installSkillFromSource } from '../anthropic_skill_installer.js';
import { resolvePlan } from './dep_resolver.js';

export interface RegistryInstallOptions {
  skillsRoot?: string;
  /** Permite warnings del auditor. Default false (rechaza warnings). */
  allowWarnings?: boolean;
}

export interface RegistryInstallResult {
  installed: Array<{ name: string; version: string; destination: string }>;
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; error: string }>;
}

export interface RollbackResult {
  ok: boolean;
  message: string;
  restoredVersion?: string;
}

const INSTALLED_INVENTORY = 'installed.json';
const ROLLBACK_DIR = '.rollback';

function readInventory(skillsRoot: string): Record<string, string> {
  const path = join(skillsRoot, INSTALLED_INVENTORY);
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>; } catch { return {}; }
}

function writeInventory(skillsRoot: string, inv: Record<string, string>): void {
  if (!existsSync(skillsRoot)) mkdirSync(skillsRoot, { recursive: true });
  writeFileSync(join(skillsRoot, INSTALLED_INVENTORY), JSON.stringify(inv, null, 2), 'utf-8');
}

function backupExisting(skillsRoot: string, name: string, version: string): boolean {
  const dst = join(skillsRoot, 'approved', `${name}@${version}`);
  if (!existsSync(dst)) return false;
  const backupRoot = join(skillsRoot, ROLLBACK_DIR, name);
  if (!existsSync(backupRoot)) mkdirSync(backupRoot, { recursive: true });
  const backupDst = join(backupRoot, version);
  if (existsSync(backupDst)) rmSync(backupDst, { recursive: true, force: true });
  // Mover para que la nueva install pueda usar el path.
  renameSync(dst, backupDst);
  return true;
}

export async function installFromRegistry(
  rootName: string,
  registry: SkillRegistry,
  opts: RegistryInstallOptions = {},
): Promise<RegistryInstallResult> {
  const skillsRoot = opts.skillsRoot ?? join(process.cwd(), 'skills');
  if (!existsSync(skillsRoot)) mkdirSync(skillsRoot, { recursive: true });

  const inventory = readInventory(skillsRoot);
  const plan = await resolvePlan(rootName, { registry, installedVersions: inventory });

  const result: RegistryInstallResult = {
    installed: [],
    skipped: plan.skipped.map(s => ({ name: s.name, reason: `${s.reason} (installed: ${s.installed})` })),
    errors: [],
  };

  for (const step of plan.steps) {
    try {
      const dst = join(skillsRoot, 'approved', `${step.name}@${step.version}`);
      // Backup de la versión ACTUALMENTE instalada (si la hay y es distinta).
      // Buscamos en inventory antes de mutar — el resolver pudo haber dejado
      // la versión anterior fuera del plan si era satisfactoria, pero si
      // llegó hasta aquí significa que va a sobrescribir.
      const previousVersion = inventory[step.name];
      let existedPrev = false;
      if (previousVersion && previousVersion !== step.version) {
        existedPrev = backupExisting(skillsRoot, step.name, previousVersion);
      } else if (existsSync(dst)) {
        // Mismo nombre@versión ya presente sin entrada en inventory:
        // backupéamoslo con su propia versión para no perder data.
        existedPrev = backupExisting(skillsRoot, step.name, step.version);
      }

      // Delegamos al anthropic_skill_installer pero apuntando al
      // directorio versionado.
      const installResult = await installSkillFromSource(step.source, {
        skillsRoot,
        allowWarnings: opts.allowWarnings,
        overwrite: true,
        author: `registry:${step.name}@${step.version}`,
      });
      if (!installResult.accepted) {
        result.errors.push({ name: step.name, error: installResult.reason ?? 'install rejected' });
        continue;
      }
      // Renombrar `approved/<name>` (que es como deja el anthropic
      // installer) a `approved/<name>@<version>` para soportar
      // múltiples versiones / rollback.
      const sourceAfterInstall = installResult.destination!;
      if (existsSync(sourceAfterInstall) && sourceAfterInstall !== dst) {
        if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
        renameSync(sourceAfterInstall, dst);
      }
      inventory[step.name] = step.version;
      writeInventory(skillsRoot, inventory);
      result.installed.push({ name: step.name, version: step.version, destination: dst });
      void existedPrev;
    } catch (e: any) {
      result.errors.push({ name: step.name, error: e?.message ?? String(e) });
    }
  }

  return result;
}

export async function rollback(name: string, opts: { skillsRoot?: string } = {}): Promise<RollbackResult> {
  const skillsRoot = opts.skillsRoot ?? join(process.cwd(), 'skills');
  const inventory = readInventory(skillsRoot);
  const currentVersion = inventory[name];
  if (!currentVersion) {
    return { ok: false, message: `${name} no está instalada según installed.json` };
  }
  const backupRoot = join(skillsRoot, ROLLBACK_DIR, name);
  if (!existsSync(backupRoot)) {
    return { ok: false, message: `no hay backups para ${name}` };
  }
  // Tomamos el backup más reciente que NO sea la versión actual.
  const candidates = readdirSync(backupRoot)
    .filter(v => v !== currentVersion && statSync(join(backupRoot, v)).isDirectory())
    .sort();
  const target = candidates[candidates.length - 1];
  if (!target) {
    return { ok: false, message: `no hay versión anterior disponible para ${name}` };
  }
  const activePath = join(skillsRoot, 'approved', `${name}@${currentVersion}`);
  const backupPath = join(backupRoot, target);
  // Mover current a backup también (para poder volver a hacer forward).
  if (existsSync(activePath)) {
    const newBackup = join(backupRoot, currentVersion);
    if (existsSync(newBackup)) rmSync(newBackup, { recursive: true, force: true });
    renameSync(activePath, newBackup);
  }
  // Restaurar target.
  const newActive = join(skillsRoot, 'approved', `${name}@${target}`);
  if (existsSync(newActive)) rmSync(newActive, { recursive: true, force: true });
  cpSync(backupPath, newActive, { recursive: true });
  rmSync(backupPath, { recursive: true, force: true });
  inventory[name] = target;
  writeInventory(skillsRoot, inventory);
  return { ok: true, message: `${name} restaurada a v${target} (desde v${currentVersion})`, restoredVersion: target };
}

export function getInstalledInventory(skillsRoot: string): Record<string, string> {
  return readInventory(skillsRoot);
}
