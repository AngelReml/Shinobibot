// Pool de credenciales API multi-proveedor — rotación de keys y cuarentena 1h tras rate-limit.
// interruptibleApiCall añade reintentos con rotación y timeout duro sobre axios (capa cloud).
import axios, { AxiosRequestConfig } from 'axios';

export class CredentialPool {
  private keysByProvider: Map<string, string[]> = new Map();
  private currentIndex: Map<string, number> = new Map();
  private quarantinedKeys: Map<string, number> = new Map();
  private QUARANTINE_MS = 60 * 60 * 1000; // 1 hora

  constructor() {
    this.loadFromEnv();
  }

  private loadFromEnv() {
    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue;
      
      let provider = '';
      if (key.match(/^OPENROUTER_KEY_\d+$/) || key === 'OPENROUTER_API_KEY') provider = 'openrouter';
      else if (key.match(/^ANTHROPIC_KEY_\d+$/) || key === 'ANTHROPIC_API_KEY') provider = 'anthropic';
      else if (key.match(/^OPENAI_KEY_\d+$/) || key === 'OPENAI_API_KEY') provider = 'openai';
      else if (key.match(/^GROQ_KEY_\d+$/) || key === 'GROQ_API_KEY') provider = 'groq';

      if (provider) {
        if (!this.keysByProvider.has(provider)) {
          this.keysByProvider.set(provider, []);
          this.currentIndex.set(provider, 0);
        }
        if (!this.keysByProvider.get(provider)!.includes(value)) {
          this.keysByProvider.get(provider)!.push(value);
        }
      }
    }
  }

  public getKey(provider: string): string | null {
    const keys = this.keysByProvider.get(provider);
    if (!keys || keys.length === 0) return null;

    let idx = this.currentIndex.get(provider) || 0;
    const initialIdx = idx;

    while (true) {
      const currentKey = keys[idx];
      const quarantineUntil = this.quarantinedKeys.get(currentKey);

      if (!quarantineUntil || Date.now() > quarantineUntil) {
        if (quarantineUntil) this.quarantinedKeys.delete(currentKey);
        this.currentIndex.set(provider, idx);
        return currentKey;
      }

      idx = (idx + 1) % keys.length;
      if (idx === initialIdx) {
        return null; // Todas en cuarentena
      }
    }
  }

  public quarantine(key: string): void {
    console.log(`[CredentialPool] Clave puesta en cuarentena por ${this.QUARANTINE_MS / 1000}s debido a Rate Limit / Error severo.`);
    this.quarantinedKeys.set(key, Date.now() + this.QUARANTINE_MS);
  }
}

export const globalCredentialPool = new CredentialPool();

/**
 * Wrapper de llamada a API que integra pool de credenciales, rotación y timeout duro.
 */
export async function interruptibleApiCall(
  provider: string,
  url: string,
  payload: any,
  configFn: (key: string) => AxiosRequestConfig,
  staleTimeoutMs: number = 60000,
  maxRetries: number = 3
): Promise<any> {
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const key = globalCredentialPool.getKey(provider);
    if (!key) {
      throw new Error(`[InterruptibleAPI] No quedan credenciales activas para el provider '${provider}'. Posible fallback requerido.`);
    }

    const config = configFn(key);
    config.timeout = staleTimeoutMs; // Timeout duro para evitar stale connections
    
    // axios interceptor / abort controller logic
    const controller = new AbortController();
    config.signal = controller.signal;

    // Timeout de fallback extra (por si el de axios falla en node interno)
    const fallbackTimer = setTimeout(() => controller.abort(), staleTimeoutMs + 5000);

    try {
      const response = await axios.post(url, payload, config);
      clearTimeout(fallbackTimer);
      return response;
    } catch (e: any) {
      clearTimeout(fallbackTimer);
      
      const status = e.response?.status;
      if (status === 429) {
        console.warn(`[InterruptibleAPI] Rate Limit (429) para ${provider}. Cuarentena y rotación...`);
        globalCredentialPool.quarantine(key);
        // Continuamos al siguiente attempt sin backoff porque hemos cambiado de key
        continue;
      }

      // Si es un error de timeout, intentamos rotar y hacer backoff
      if (e.code === 'ECONNABORTED' || e.name === 'CanceledError' || e.message?.includes('timeout')) {
        console.warn(`[InterruptibleAPI] Timeout (${staleTimeoutMs}ms) conectando a ${provider}. Reintentando...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }

      // Errores de autenticación
      if (status === 401) {
        console.error(`[InterruptibleAPI] Clave inválida (401) para ${provider}. Cuarentena y rotación...`);
        globalCredentialPool.quarantine(key);
        continue;
      }

      // Otros errores (500, etc), lanzamos
      throw e;
    }
  }

  throw new Error(`[InterruptibleAPI] Fallo definitivo tras ${maxRetries} reintentos en ${provider}.`);
}
