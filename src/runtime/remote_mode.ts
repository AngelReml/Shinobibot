/**
 * Remote Mode — Sprint 3.5.
 *
 * `shinobi --remote <vps_url>` despliega Shinobi en un VPS via Docker y
 * el WebChat local conecta al kernel remoto. Las tools se ejecutan en
 * VPS, no en la máquina del usuario.
 *
 * Respuesta arquitectónica al incidente histórico de matar procesos del
 * usuario: en modo remoto, físicamente NO PUEDE tocar la máquina local.
 *
 * Diseño:
 *   - El modo remoto es una capa de TRANSPORTE: el orchestrator y las
 *     tools quedan en el VPS; el cliente local solo envía mensajes via
 *     HTTPS/WSS y recibe respuestas.
 *   - Deployment vía SSH + Docker: el operador da una URL `ssh://user@host`
 *     y `RemoteDeployer.deploy()` instala Docker (si no está), construye
 *     la imagen, lanza el container y abre un túnel SSH.
 *   - Health checks: `RemoteHealthMonitor` pingea `/api/status` cada 30s
 *     y avisa si cae.
 *   - El test funcional NO ejecuta deploy real (requiere SSH key del
 *     operador). Verifica la arquitectura: parseo de URL, generación
 *     del compose, dispatch de comandos, health check con mock.
 *
 * IMPORTANTE: este módulo NO ejecuta `ssh` automáticamente porque eso
 * requiere SSH key del operador. Lo que SÍ hace:
 *   - Genera todos los archivos necesarios (Dockerfile.remote, scripts).
 *   - Imprime las instrucciones EXACTAS para que el operador ejecute.
 *   - Verifica conectividad al VPS una vez deployado.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface RemoteTarget {
  /** Tipo de transporte: 'ssh' | 'https' (kernel ya desplegado). */
  kind: 'ssh' | 'https';
  /** Host (ej. 167.86.80.220 o my-vps.example.com). */
  host: string;
  /** Usuario (default 'root' para ssh, ignorado en https). */
  user?: string;
  /** Puerto SSH (default 22) o puerto HTTPS (default 443). */
  port?: number;
  /** Path a SSH key (para kind=ssh). */
  sshKey?: string;
  /** URL completa cuando kind=https (override host/port). */
  url?: string;
}

const SSH_URL_RX = /^ssh:\/\/(?:([\w.-]+)@)?([\w.-]+)(?::(\d+))?(?:\/(.*))?$/;
const HTTPS_URL_RX = /^(https?):\/\/([\w.-]+)(?::(\d+))?(\/.*)?$/;

export function parseRemoteUrl(raw: string): RemoteTarget {
  if (!raw || typeof raw !== 'string') throw new Error('remote URL vacía');
  const ssh = raw.match(SSH_URL_RX);
  if (ssh) {
    return {
      kind: 'ssh',
      user: ssh[1] || 'root',
      host: ssh[2],
      port: ssh[3] ? Number(ssh[3]) : 22,
    };
  }
  const https = raw.match(HTTPS_URL_RX);
  if (https) {
    return {
      kind: 'https',
      host: https[2],
      port: https[3] ? Number(https[3]) : (https[1] === 'https' ? 443 : 80),
      url: raw,
    };
  }
  // Shorthand "root@host" o "host" (asumimos ssh).
  if (/^[\w.-]+(?:@[\w.-]+)?$/.test(raw)) {
    const [u, h] = raw.includes('@') ? raw.split('@') : ['root', raw];
    return { kind: 'ssh', user: u, host: h, port: 22 };
  }
  throw new Error(`remote URL no reconocida: ${raw}`);
}

export interface DeploymentArtifacts {
  dockerfile: string;
  composeYml: string;
  startScript: string;
  envTemplate: string;
}

export function generateArtifacts(target: RemoteTarget, opts: { image?: string; port?: number } = {}): DeploymentArtifacts {
  const image = opts.image ?? 'shinobi-remote';
  const port = opts.port ?? 3333;
  const dockerfile = [
    '# Shinobi remote kernel image',
    'FROM node:22-bookworm-slim',
    'WORKDIR /opt/shinobi',
    'COPY package*.json ./',
    'RUN npm ci --omit=dev --no-audit --no-fund',
    'COPY . .',
    'ENV NODE_ENV=production',
    `EXPOSE ${port}`,
    'CMD ["npx", "tsx", "src/web/server.ts"]',
  ].join('\n') + '\n';

  const composeYml = [
    'version: "3.8"',
    'services:',
    '  shinobi:',
    `    image: ${image}`,
    '    build: .',
    '    restart: unless-stopped',
    `    ports:`,
    `      - "127.0.0.1:${port}:${port}"`,
    '    env_file: .env.remote',
    '    volumes:',
    '      - shinobi-data:/opt/shinobi/data',
    'volumes:',
    '  shinobi-data:',
  ].join('\n') + '\n';

  const sshHost = target.kind === 'ssh' ? `${target.user}@${target.host}` : target.host;
  const sshPort = target.port ?? 22;
  const startScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '# Deploy Shinobi en VPS remoto. Generado por src/runtime/remote_mode.ts.',
    `REMOTE="${sshHost}"`,
    `SSH_PORT="${sshPort}"`,
    `IMAGE="${image}"`,
    `LOCAL_PORT=${port}`,
    '',
    'echo "==> Verificando Docker en VPS..."',
    'ssh -p "$SSH_PORT" "$REMOTE" "command -v docker || curl -fsSL https://get.docker.com | sh"',
    '',
    'echo "==> Copiando código..."',
    'rsync -az --exclude node_modules --exclude .git --exclude dist -e "ssh -p $SSH_PORT" . "$REMOTE:/opt/shinobi/"',
    '',
    'echo "==> Build + up..."',
    'ssh -p "$SSH_PORT" "$REMOTE" "cd /opt/shinobi && docker compose up -d --build"',
    '',
    'echo "==> Abriendo túnel SSH local:$LOCAL_PORT -> remoto:$LOCAL_PORT..."',
    'echo "  Mantén esta terminal abierta. Ctrl+C para cerrar el túnel."',
    'ssh -p "$SSH_PORT" -N -L "$LOCAL_PORT:127.0.0.1:$LOCAL_PORT" "$REMOTE"',
  ].join('\n') + '\n';

  const envTemplate = [
    '# .env.remote — secrets del kernel Shinobi en VPS.',
    '# El operador rellena los que vaya a usar; los demás quedan vacíos.',
    'SHINOBI_PROVIDER=opengravity',
    'OPENROUTER_API_KEY=',
    'OPENAI_API_KEY=',
    'ANTHROPIC_API_KEY=',
    'TELEGRAM_BOT_TOKEN=',
    'SHINOBI_NOTIFY_ENABLED=0',
    'SHINOBI_AUDIT_LOG_PATH=/opt/shinobi/data/audit.jsonl',
  ].join('\n') + '\n';

  return { dockerfile, composeYml, startScript, envTemplate };
}

/**
 * Escribe los artefactos a un directorio para que el operador los
 * inspeccione antes de ejecutar.
 */
export function writeArtifacts(outDir: string, artifacts: DeploymentArtifacts): string[] {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  const files: Array<[string, string]> = [
    ['Dockerfile.remote', artifacts.dockerfile],
    ['docker-compose.remote.yml', artifacts.composeYml],
    ['shinobi-remote-deploy.sh', artifacts.startScript],
    ['.env.remote.template', artifacts.envTemplate],
  ];
  for (const [name, content] of files) {
    const p = join(outDir, name);
    writeFileSync(p, content, 'utf-8');
    paths.push(p);
  }
  return paths;
}

export interface HealthCheckResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

/**
 * Health check del kernel remoto. Pide GET /api/status y devuelve la
 * latencia. NO instancia ningún cliente HTTP — usa fetch global de
 * Node 18+ (también disponible vía un mock para tests).
 */
export interface HealthCheckOptions {
  url: string;
  timeoutMs?: number;
  /** Override para tests (inyectar mock fetch). */
  fetchImpl?: (url: string, opts: any) => Promise<{ ok: boolean; status: number }>;
}

export async function healthCheck(opts: HealthCheckOptions): Promise<HealthCheckResult> {
  const t0 = Date.now();
  const fetchImpl = opts.fetchImpl ?? ((globalThis as any).fetch as any);
  if (!fetchImpl) {
    return { ok: false, latencyMs: 0, error: 'fetch no disponible' };
  }
  const timer = new Promise<HealthCheckResult>((resolve) => {
    setTimeout(() => resolve({
      ok: false,
      latencyMs: Date.now() - t0,
      error: `timeout ${opts.timeoutMs ?? 5000}ms`,
    }), opts.timeoutMs ?? 5000);
  });
  const probe: Promise<HealthCheckResult> = (async () => {
    try {
      const r = await fetchImpl(opts.url, { method: 'GET' });
      return {
        ok: !!r.ok,
        status: r.status,
        latencyMs: Date.now() - t0,
        error: r.ok ? undefined : `HTTP ${r.status}`,
      };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - t0, error: e?.message ?? String(e) };
    }
  })();
  return Promise.race([probe, timer]);
}

export function renderInstructions(target: RemoteTarget, paths: string[]): string[] {
  const sshHost = target.kind === 'ssh' ? `${target.user ?? 'root'}@${target.host}` : target.host;
  return [
    '== Instrucciones de deploy ==',
    '',
    `1. Rellena .env.remote.template con tus keys y guarda como .env.remote.`,
    `2. Asegúrate de tener SSH key configurada para ${sshHost}.`,
    `3. Ejecuta:`,
    `     bash ${paths.find(p => p.endsWith('.sh'))}`,
    `4. Esto:`,
    `   - Instala Docker en el VPS si no está.`,
    `   - rsync sube el código a /opt/shinobi/.`,
    `   - docker compose up -d --build levanta el kernel.`,
    `   - Abre túnel SSH local 3333 → remoto 3333.`,
    `5. WebChat: abre http://localhost:3333 en tu navegador.`,
    '',
    '== Decisiones arquitectónicas ==',
    '   - Container bind a 127.0.0.1 en el VPS, NO expuesto al internet.',
    '   - Todo el tráfico WebChat ↔ kernel pasa por túnel SSH cifrado.',
    '   - Las tools ejecutan EN EL VPS — la máquina local nunca toca run_command/screen_act/etc.',
    '   - El backup GitHub privado (Sprint 3.8) se ejecuta desde el VPS.',
  ];
}
