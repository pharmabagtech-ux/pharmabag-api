import { PageSeoService } from './page-seo.service';

/**
 * Path normalisation is the whole contract of this module: the storefront
 * looks an override up by the page's own path, so if the stored key and the
 * looked-up key disagree by a trailing slash or a capital letter, the override
 * silently does nothing and looks like a bug in the admin panel.
 */
describe('PageSeoService.normalizePath', () => {
  const n = PageSeoService.normalizePath;

  it('keeps an already-canonical path unchanged', () => {
    expect(n('/categories/ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('adds a leading slash', () => {
    expect(n('categories/ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('strips trailing slashes', () => {
    expect(n('/categories/ayurvedic/')).toBe('/categories/ayurvedic');
    expect(n('/categories/ayurvedic///')).toBe('/categories/ayurvedic');
  });

  it('lowercases, so /Categories/Ayurvedic is the same page', () => {
    expect(n('/Categories/Ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('drops query strings and hashes', () => {
    expect(n('/categories/ayurvedic?page=2')).toBe('/categories/ayurvedic');
    expect(n('/categories/ayurvedic#faq')).toBe('/categories/ayurvedic');
    expect(n('/products?search=dolo&sort=price')).toBe('/products');
  });

  it('preserves the root as a single slash rather than emptying it', () => {
    expect(n('/')).toBe('/');
    expect(n('')).toBe('/');
    expect(n('   ')).toBe('/');
  });

  it('handles the deepest real routes', () => {
    expect(n('/categories/ayurvedic/syrup/')).toBe('/categories/ayurvedic/syrup');
    expect(n('/wholesale-medicine-suppliers/west-bengal/kolkata')).toBe(
      '/wholesale-medicine-suppliers/west-bengal/kolkata',
    );
  });
});
