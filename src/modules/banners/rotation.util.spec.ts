import { clampRotationSeconds, DEFAULT_ROTATION_SECONDS } from './rotation.util';

/**
 * This value reaches the storefront and becomes a setInterval delay. A zero or
 * negative number would spin the slideshow as fast as React can re-render; a
 * huge one would park it on slide 1 forever and read as "the rotation is
 * broken".
 *
 * Both ends are clamped rather than rejected because this is read from a
 * free-form JSON settings row on a PUBLIC, CACHED endpoint. A row someone
 * hand-edited must not be able to 500 every category page.
 */
describe('clampRotationSeconds', () => {
  it('passes a sensible value through', () => {
    expect(clampRotationSeconds(5)).toBe(5);
    expect(clampRotationSeconds(12)).toBe(12);
  });

  it('clamps to the 2-second floor', () => {
    expect(clampRotationSeconds(0)).toBe(2);
    expect(clampRotationSeconds(-10)).toBe(2);
    expect(clampRotationSeconds(1)).toBe(2);
  });

  it('clamps to the 30-second ceiling', () => {
    expect(clampRotationSeconds(31)).toBe(30);
    expect(clampRotationSeconds(100000)).toBe(30);
  });

  it('rounds a fractional value', () => {
    expect(clampRotationSeconds(5.6)).toBe(6);
    expect(clampRotationSeconds(5.2)).toBe(5);
  });

  it('falls back to the default for anything that is not a usable number', () => {
    expect(clampRotationSeconds(undefined)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(null)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds('abc')).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(NaN)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(Infinity)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds({})).toBe(DEFAULT_ROTATION_SECONDS);
  });

  it('accepts a numeric string, because JSON settings rows get hand-edited', () => {
    expect(clampRotationSeconds('8')).toBe(8);
  });
});
