// Tenshu (天守): el puente de mando sobre todo el dojo — VER/CONDUCIR/ENTENDER/CONSULTAR + SPA local + kill switch limpio; refleja, no narra. Gated TENSHU_ENABLED.
/**
 * tenshu — barrel. The command bridge over the whole dojo. Additive + gated by
 * TENSHU_ENABLED (default off). Refleja, no narra; kill switch limpio.
 */
export * from './config.js';
export * from './types.js';
export { EventBus, sharedEventBus, type Subscriber } from './bus.js';
export { ControlPlane, sharedControlPlane, type Directive } from './control.js';
export { reflect, assertReflected, type PanelClaim, type ReflectResult } from './reflect.js';
export { buildDojoStatus, type StatusInputs } from './status.js';
export { browseTev, tevSummary, verifyTevLinkage, type ChainVerdict } from './tev_browser.js';
export { ApprovalQueue, type PendingApproval } from './approvals.js';
export { exportForAudit, verifyAuditBundle, type AuditBundle, type AuditVerdict } from './export.js';
export { buildSystemMap, renderSystemMap, DOJO_TOPOLOGY, type SystemMap, type MapNode } from './system_map.js';
export { buildState, applyCommand, type TenshuSpaDeps, type TenshuState, type CommandResult } from './spa/state.js';
export { createTenshuApp, startTenshuSpa, type TenshuSpaServer } from './spa/server.js';
export { SPA_HTML } from './spa/page.js';
