import { parseDeviceOsBrowser } from './ua-parser';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const CHROMEOS =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0';

describe('parseDeviceOsBrowser', () => {
  it('Chrome on Windows desktop', () => {
    expect(parseDeviceOsBrowser(CHROME_WIN)).toEqual({ deviceType: 'desktop', os: 'Windows', browser: 'Chrome' });
  });

  it('Safari on iPhone is mobile/iOS', () => {
    expect(parseDeviceOsBrowser(SAFARI_IPHONE)).toEqual({ deviceType: 'mobile', os: 'iOS', browser: 'Safari' });
  });

  it('Chrome on Android phone is mobile', () => {
    expect(parseDeviceOsBrowser(CHROME_ANDROID)).toMatchObject({ deviceType: 'mobile', os: 'Android', browser: 'Chrome' });
  });

  it('Android without a Mobile token is a tablet', () => {
    expect(parseDeviceOsBrowser(ANDROID_TABLET)).toMatchObject({ deviceType: 'tablet', os: 'Android' });
  });

  it('Edge is not misread as Chrome', () => {
    expect(parseDeviceOsBrowser(EDGE_WIN).browser).toBe('Edge');
  });

  it('Samsung Internet is not misread as Chrome', () => {
    expect(parseDeviceOsBrowser(SAMSUNG).browser).toBe('Samsung Internet');
  });

  it('ChromeOS is not misread as Linux', () => {
    expect(parseDeviceOsBrowser(CHROMEOS).os).toBe('ChromeOS');
  });

  it('Chrome on iOS (CriOS) is recognized as Chrome, on iOS', () => {
    expect(parseDeviceOsBrowser(CHROME_IOS)).toMatchObject({ os: 'iOS', browser: 'Chrome' });
  });

  it('Firefox on macOS', () => {
    expect(parseDeviceOsBrowser(FIREFOX_MAC)).toEqual({ deviceType: 'desktop', os: 'macOS', browser: 'Firefox' });
  });

  it('empty or missing UA falls back to Unknown/Unknown/desktop', () => {
    expect(parseDeviceOsBrowser('')).toEqual({ deviceType: 'desktop', os: 'Unknown', browser: 'Unknown' });
    expect(parseDeviceOsBrowser(null)).toEqual({ deviceType: 'desktop', os: 'Unknown', browser: 'Unknown' });
    expect(parseDeviceOsBrowser(undefined)).toEqual({ deviceType: 'desktop', os: 'Unknown', browser: 'Unknown' });
  });
});
