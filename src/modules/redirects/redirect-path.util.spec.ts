import { normalizePath, isNoisePath } from './redirect-path.util';

describe('normalizePath', () => {
  it('lowercases and keeps a clean path', () => {
    expect(normalizePath('/Products/Old-Slug')).toBe('/products/old-slug');
  });

  it('adds the leading slash when missing', () => {
    expect(normalizePath('products/abc')).toBe('/products/abc');
  });

  it('strips query strings and fragments', () => {
    expect(normalizePath('/products/abc?utm_source=x#top')).toBe('/products/abc');
  });

  it('strips trailing slashes', () => {
    expect(normalizePath('/products/abc/')).toBe('/products/abc');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('//products///abc')).toBe('/products/abc');
  });

  it('refuses the root — the homepage is never redirected or logged', () => {
    expect(normalizePath('/')).toBeNull();
    expect(normalizePath('')).toBeNull();
  });

  it('refuses absurdly long paths', () => {
    expect(normalizePath('/' + 'a'.repeat(600))).toBeNull();
  });

  it('refuses full URLs — only site-relative paths belong in the tables', () => {
    expect(normalizePath('https://evil.example/steal')).toBeNull();
  });
});

describe('isNoisePath', () => {
  it.each([
    '/wp-admin/setup.php',
    '/index.php',
    '/backup.sql',
    '/.env',
    '/.git/config',
    '/phpmyadmin',
    '/xmlrpc.php',
    '/cgi-bin/test',
    '/config.bak',
  ])('flags scanner probe %s', (p) => {
    expect(isNoisePath(p)).toBe(true);
  });

  it.each([
    '/products/old-medicine-name-pb123',
    '/blogs/some-old-post',
    '/wholesale-medicine-suppliers/kolkata',
  ])('keeps a genuine catalogue path %s', (p) => {
    expect(isNoisePath(p)).toBe(false);
  });
});
