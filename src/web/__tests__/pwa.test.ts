/**
 * PWA smoke tests — verifica que el manifest, el service worker y los
 * meta tags del index.html están en sitio.
 *
 * Tier B #17: WebChat mobile-friendly / instalable como PWA.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PUBLIC = resolve(process.cwd(), 'src/web/public');

describe('manifest.webmanifest', () => {
  it('existe y es JSON válido', () => {
    const path = resolve(PUBLIC, 'manifest.webmanifest');
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf-8');
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('tiene los campos PWA obligatorios', () => {
    const m = JSON.parse(readFileSync(resolve(PUBLIC, 'manifest.webmanifest'), 'utf-8'));
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.length).toBeGreaterThan(0);
  });

  it('icons incluye 192x192 con purpose any o maskable', () => {
    const m = JSON.parse(readFileSync(resolve(PUBLIC, 'manifest.webmanifest'), 'utf-8'));
    const has192 = m.icons.some((i: any) =>
      i.sizes === '192x192' && (i.purpose?.includes('any') || i.purpose?.includes('maskable')),
    );
    expect(has192).toBe(true);
  });
});

describe('sw.js', () => {
  it('existe', () => {
    expect(existsSync(resolve(PUBLIC, 'sw.js'))).toBe(true);
  });

  it('NO cachea /api/ ni /ws', () => {
    const text = readFileSync(resolve(PUBLIC, 'sw.js'), 'utf-8');
    expect(text).toContain('/api/');
    expect(text).toContain('/ws');
    // Heurística básica: la función fetch debe escapar /api/ y /ws temprano.
    expect(text).toMatch(/url\.pathname\.startsWith\(['"]\/api\/['"]\)/);
  });

  it('define CACHE_NAME versionado', () => {
    const text = readFileSync(resolve(PUBLIC, 'sw.js'), 'utf-8');
    expect(text).toMatch(/CACHE_NAME\s*=\s*['"]shinobi-shell-v\d+['"]/);
  });

  it('lista shell assets incluyendo /', () => {
    const text = readFileSync(resolve(PUBLIC, 'sw.js'), 'utf-8');
    expect(text).toContain("'/'");
    expect(text).toContain('/styles/base.css');
    expect(text).toContain('/js/app.js');
  });
});

describe('index.html — meta tags PWA', () => {
  const html = readFileSync(resolve(PUBLIC, 'index.html'), 'utf-8');

  it('viewport mobile-friendly con viewport-fit=cover', () => {
    expect(html).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
  });

  it('theme-color presente', () => {
    expect(html).toMatch(/<meta name="theme-color"/);
  });

  it('manifest enlazado', () => {
    expect(html).toMatch(/<link[^>]*rel="manifest"/);
    expect(html).toContain('/manifest.webmanifest');
  });

  it('apple-mobile-web-app-capable presente', () => {
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
  });

  it('apple-touch-icon presente', () => {
    expect(html).toMatch(/<link[^>]*rel="apple-touch-icon"/);
  });

  it('script registra el service worker', () => {
    expect(html).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('solo registra el SW en http/https, no en file://', () => {
    // Defensa contra registros que rompen con file:// en algunos contextos.
    expect(html).toContain("location.protocol === 'http:'");
  });
});
