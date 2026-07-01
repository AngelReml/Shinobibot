// F2.1 — clasificador puro de IPs privadas/reservadas/metadata. Sin I/O.
import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, isLoopbackIp, isIPv4 } from '../ip_ranges.js';

describe('ip_ranges — isPrivateOrReservedIp', () => {
  it('bloquea RFC1918 (10/8, 172.16/12, 192.168/16)', () => {
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.255.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false); // fuera del /12
    expect(isPrivateOrReservedIp('192.168.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.169.0.1')).toBe(false); // fuera del /16
  });

  it('bloquea link-local incl. el endpoint de metadata cloud 169.254.169.254', () => {
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.0.1')).toBe(true);
  });

  it('bloquea CGNAT (100.64.0.0/10) y 0.0.0.0/8', () => {
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('100.127.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.1')).toBe(true);
  });

  it('NO bloquea loopback (127/8, ::1) — excepción deliberada (Ollama local etc.)', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('127.5.5.5')).toBe(false);
    expect(isPrivateOrReservedIp('::1')).toBe(false);
  });

  it('NO bloquea IPs públicas normales', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
  });

  it('detecta IPv4-mapped IPv6 disfrazando una IP privada ("::ffff:10.0.0.1")', () => {
    expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('bloquea IPv6 unique-local (fc00::/7) y link-local (fe80::/10)', () => {
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fd12:3456::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
  });

  it('IPv6 público normal no se bloquea', () => {
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
  });

  it('isLoopbackIp / isIPv4 helpers', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('8.8.8.8')).toBe(false);
    expect(isIPv4('8.8.8.8')).toBe(true);
    expect(isIPv4('not-an-ip')).toBe(false);
    expect(isIPv4('2606:4700::1')).toBe(false);
  });

  it('hostname (no IP) devuelve false — el caller decide qué hacer', () => {
    expect(isPrivateOrReservedIp('example.com')).toBe(false);
  });
});
