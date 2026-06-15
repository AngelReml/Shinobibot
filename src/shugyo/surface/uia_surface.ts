/**
 * shugyo/surface/uia_surface.ts — S-12: the hard UIA regime (dossier §8, AFTER CLI).
 * When a program has no CLI/COM, the surface is its UI tree. This builds, from an
 * (injected) UIA observation, the ActionSurface — the actionable controls as
 * Affordances — and a UI GRAPH (parent→children) for navigation. The live UIA read
 * is the dynamic probe (M-11 / injected); the SURFACE EXTRACTION here is pure.
 *
 * Reversibility is classified conservatively from the control's name (anti-destruction
 * carries over from §7.2): destructive verbs → destructive; send/order → external_effect;
 * plain navigation/open → reversible; unknown → unknown (fail-closed downstream).
 */

import { classifyReversibility } from '../explore/reversibility.js';
import type { Affordance, ActionSurface, Reversibility } from '../types.js';

export interface UiaNode {
  automation_id?: string;
  name?: string;
  control_type: string;        // 'Button' | 'MenuItem' | 'Edit' | 'Text' | 'Window' | ...
  children?: UiaNode[];
}

const ACTIONABLE = new Set(['Button', 'MenuItem', 'CheckBox', 'RadioButton', 'Edit', 'ComboBox', 'Hyperlink', 'TabItem', 'ListItem', 'Slider']);

/** Reversibility of a UI control from its label (reuses Shugyō's classifier). */
function controlReversibility(name: string): Reversibility {
  return classifyReversibility(name);
}

/** Flatten a UIA tree into actionable Affordances (named, actionable control types). */
export function extractAffordances(root: UiaNode): Affordance[] {
  const out: Affordance[] = [];
  let seq = 0;
  const walk = (n: UiaNode) => {
    const label = (n.name ?? n.automation_id ?? '').trim();
    if (label && ACTIONABLE.has(n.control_type)) {
      out.push({
        affordance_id: `uia_${++seq}_${n.control_type}`,
        kind: 'ui_control',
        label,
        signature: `${n.control_type}:${label}`,
        reversibility: controlReversibility(label),
      });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

export function buildUiSurface(appId: string, root: UiaNode): ActionSurface {
  return { app_id: appId, via: 'uia', affordances: extractAffordances(root) };
}

export interface UiEdge { from: string; to: string; }
export interface UiGraph { nodes: string[]; edges: UiEdge[] }

/** A navigation graph (parent label → child label) for the UI tree. */
export function uiGraph(root: UiaNode): UiGraph {
  const nodes: string[] = [];
  const edges: UiEdge[] = [];
  const idOf = (n: UiaNode, i: number) => (n.name ?? n.automation_id ?? `${n.control_type}#${i}`);
  let counter = 0;
  const walk = (n: UiaNode, parentId: string | null) => {
    const id = idOf(n, counter++);
    nodes.push(id);
    if (parentId) edges.push({ from: parentId, to: id });
    for (const c of n.children ?? []) walk(c, id);
  };
  walk(root, null);
  return { nodes, edges };
}
