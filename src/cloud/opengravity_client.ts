// opengravity_client.ts — EXTIRPADO (Fase 4, 2026-06-12)
// Gateway cloud eliminado: los providers LLM se invocan directamente.
export class OpenGravityClient {
  static async checkHealth(): Promise<boolean> { return false; }
  static async startSwarmMission(_p: unknown, _c?: unknown): Promise<never> {
    throw new Error('OpenGravityClient extirpado');
  }
  static async invokeLLM(_p: unknown): Promise<never> {
    throw new Error('OpenGravityClient extirpado — usa un provider directo');
  }
  static async invokeWorkflow(_id: unknown, _inputs: unknown): Promise<never> {
    throw new Error('OpenGravityClient extirpado');
  }
}
