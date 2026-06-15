/**
 * kangeiko/curve.ts — the capability curve (dossier §2.3). Tareas-con-oráculo
 * superadas a lo largo del tiempo: auto-mejora COMPROBADA, no contada. Imposible
 * de falsear porque cada peldaño está certificado. Pure.
 */

import type { CurvePoint } from './types.js';

export function passRate(p: CurvePoint): number {
  return p.total === 0 ? 0 : p.passed / p.total;
}

/** Did the curve rise? End strictly above start AND never regressed mid-way. */
export function curveRising(points: CurvePoint[]): boolean {
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i++) {
    if (passRate(points[i]) < passRate(points[i - 1]) - 1e-9) return false; // a regression breaks it
  }
  return passRate(points[points.length - 1]) > passRate(points[0]) + 1e-9;
}

/** Net improvement in pass-rate from first to last measured point. */
export function curveDelta(points: CurvePoint[]): number {
  if (points.length < 2) return 0;
  return passRate(points[points.length - 1]) - passRate(points[0]);
}
