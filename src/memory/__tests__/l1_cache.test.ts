// src/memory/__tests__/l1_cache.test.ts

import { describe, it, expect } from 'vitest';
import { L1Cache } from '../l1_cache.js';

describe('L1Cache', () => {
  it('puede almacenar y recuperar valores', () => {
    const cache = new L1Cache<string, number>(10, 1000);
    cache.set('foo', 42);
    expect(cache.get('foo')).toBe(42);
    expect(cache.get('bar')).toBeUndefined();
  });

  it('respeta la expiracion TTL', async () => {
    const cache = new L1Cache<string, number>(10, 50); // 50ms TTL
    cache.set('foo', 42);
    expect(cache.get('foo')).toBe(42);

    await new Promise(resolve => setTimeout(resolve, 80));
    expect(cache.get('foo')).toBeUndefined();
  });

  it('aplica la politica de desalojo LRU al superar el limite maximo', () => {
    const cache = new L1Cache<string, number>(3, 1000); // Max 3 entries
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it recently used
    cache.get('a');

    // Add 'd', should evict 'b' (oldest unused)
    cache.set('d', 4);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('permite eliminar elementos y limpiar la cache', () => {
    const cache = new L1Cache<string, number>(10, 1000);
    cache.set('foo', 42);
    cache.set('bar', 99);

    cache.delete('foo');
    expect(cache.get('foo')).toBeUndefined();
    expect(cache.get('bar')).toBe(99);

    cache.clear();
    expect(cache.get('bar')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});
