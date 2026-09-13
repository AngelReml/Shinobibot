import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Resolve the writable per-user data directory used by persistent stores. */
export function shinobiDataDir(): string {
  const candidates = [
    process.env.SHINOBI_DATA_DIR,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Shinobi') : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Shinobi') : undefined,
    path.join(os.homedir(), '.shinobi'),
    path.join(os.tmpdir(), 'Shinobi'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      const probe = path.join(candidate, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe, { force: true });
      return candidate;
    } catch {
      /* try the next location */
    }
  }

  throw new Error('Shinobi: no hay un directorio de datos escribible. Define SHINOBI_DATA_DIR.');
}
