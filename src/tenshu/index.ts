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
