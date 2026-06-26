// src/benchmark/shinobi/http_agent_server.ts
//
// Servidor HTTP que expone Shinobi como agente llamable externamente.
// Contrato (ShinobiBench Comparativo v1.0):
//
//   POST /
//   Body:     { task: ShinobiTask, files_dir: string }
//   Response: { output: string }
//
//   GET  /health  →  { ok: true, version: string }
//
// Configuración:
//   SHINOBI_BENCH_PORT        Puerto de escucha (default 9901)
//   SHINOBI_BENCH_TOKEN       Bearer token opcional; si está definido, se exige
//   SHINOBI_BENCH_MODEL       Modelo a usar (override global de provider_router)
//   SHINOBI_BENCH_MAX_ITERATIONS  Iteraciones máximas en tareas compound (default 12)

import express from 'express';
import { createServer } from 'http';
import { routeTask } from './task_router.js';
import type { ShinobiBenchRequest, ShinobiBenchResponse } from './types.js';

const VERSION = '1.0.0';

function buildApp(token?: string): express.Application {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Auth middleware — solo activo si SHINOBI_BENCH_TOKEN está definido.
  if (token) {
    app.use((req, res, next) => {
      if (req.path === '/health') return next();
      const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (auth !== token) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });
  }

  // Health check — para que el runner sepa que el server está vivo.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  // Endpoint principal del benchmark.
  app.post('/', async (req, res) => {
    const body = req.body as Partial<ShinobiBenchRequest>;

    if (!body?.task || typeof body.task.prompt !== 'string' || !body.task.category) {
      res.status(400).json({ error: 'body must be { task: { id, category, prompt }, files_dir }' });
      return;
    }

    const task = body.task;
    const filesDir = typeof body.files_dir === 'string' ? body.files_dir : '';
    const timeoutMs = ((task.setup?.timeout_seconds ?? 300) * 1000);

    // AbortController para respetar el timeout de la tarea.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      let output: string;

      // Envolvemos en una race para respetar el timeout del AbortController.
      const raceTimeout = new Promise<never>((_res, rej) => {
        ac.signal.addEventListener('abort', () => rej(new Error('task timeout')));
      });

      output = await Promise.race([
        routeTask(task, filesDir),
        raceTimeout,
      ]);

      clearTimeout(timer);
      const body2: ShinobiBenchResponse = { output };
      res.json(body2);
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.message === 'task timeout';
      res.status(isTimeout ? 504 : 500).json({
        output: '',
        error: err?.message ?? String(err),
      });
    }
  });

  return app;
}

export interface BenchServerOptions {
  port?: number;
  token?: string;
}

/**
 * Arranca el servidor HTTP del agente de benchmark.
 * Devuelve el puerto real (útil en tests con port=0).
 */
export async function startBenchAgentServer(opts: BenchServerOptions = {}): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = opts.port ?? (Number(process.env.SHINOBI_BENCH_PORT) || 9901);
  const token = opts.token ?? (process.env.SHINOBI_BENCH_TOKEN || undefined);

  const app = buildApp(token);
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });

  const addr = server.address();
  const realPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`[bench-agent] Shinobi HTTP agent escuchando en :${realPort} (token: ${token ? 'sí' : 'no'})`);

  const stop = () => new Promise<void>((res, rej) => server.close((e) => e ? rej(e) : res()));
  return { port: realPort, stop };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
// Arranca directamente si se lanza como: tsx src/benchmark/shinobi/http_agent_server.ts

const isMain = process.argv[1]?.endsWith('http_agent_server.ts') ||
               process.argv[1]?.endsWith('http_agent_server.js');

if (isMain) {
  startBenchAgentServer().catch((err) => {
    console.error('[bench-agent] Error al arrancar:', err);
    process.exit(1);
  });
}
