// kernel_client.ts — EXTIRPADO (Fase 1, 2026-06-12)
// Kernel bridge eliminado. Este stub existe únicamente para que
// cualquier importador residual compile; no debe haber importadores tras F1.
export class KernelClient {
  static async isOnline(): Promise<boolean> { return false; }
  static async startMission(_: unknown): Promise<never> {
    throw new Error('KernelClient extirpado — usa modo local');
  }
  static async waitMission(_: unknown): Promise<never> {
    throw new Error('KernelClient extirpado — usa modo local');
  }
}
