/**
 * APP_VERSION — single source of truth for the running app version.
 * Reads from package.json at module load so it always tracks the real release,
 * never a copy-pasted literal that drifts on bumps.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = _require(resolve(__dirname, '../../package.json')) as { version: string };

export const APP_VERSION: string = pkg.version ?? '0.0.0';
