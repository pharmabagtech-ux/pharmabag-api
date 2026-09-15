jest.mock('https', () => ({ request: jest.fn() }));

import { EventEmitter } from 'events';
import * as https from 'https';
import { IdfyService } from './idfy.service';

/**
 * Both transport helpers set `timeout` in the request options but only ever
 * registered `req.on('error')`. Node does not abort on `timeout` by itself —
 * it just emits the event — so a stalled vendor socket hung the request
 * indefinitely. That is how a 35.8s Masters India call blew past the buyer's
 * 30s axios timeout and surfaced as "Network error. Please check your
 * connection."
 *
 * A stall must now fail fast, and fail as something the retry layer
 * recognises as transient.
 */

const CONFIGURED_ENV = {
  MASTERS_INDIA_CLIENT_ID: 'client-id',
  MASTERS_INDIA_CLIENT_SECRET: 'client-secret',
  MASTERS_INDIA_USERNAME: 'user',
  MASTERS_INDIA_PASSWORD: 'pass',
} as Record<string, string>;

const requestMock = https.request as unknown as jest.Mock;

const fakeRequest = () => {
  const req: any = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn();
  req.destroy = jest.fn((err?: Error) => {
    if (err) req.emit('error', err);
  });
  return req;
};

const newService = () => {
  const service = new IdfyService({
    get: (key: string) => CONFIGURED_ENV[key],
  } as any);
  (service as any).logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  return service;
};

const GET_URL =
  'https://commonapi.mastersindia.co/commonapis/searchgstin?gstin=19CEWPR5040D1Z3';
const OAUTH_URL = 'https://commonapi.mastersindia.co/oauth/access_token';

describe('a stalled socket fails fast instead of hanging forever', () => {
  beforeEach(() => requestMock.mockReset());

  it('makeGetRequest rejects with a retryable timeout when the socket stalls', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation(() => req);

    const promise: Promise<any> = (newService() as any).makeGetRequest(
      GET_URL,
      'tok',
      { deadline: Date.now() + 20_000 },
    );
    req.emit('timeout');

    await expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(req.destroy).toHaveBeenCalled();
  });

  it('makePostRequest rejects with a retryable timeout when the socket stalls', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation(() => req);

    const promise: Promise<any> = (newService() as any).makePostRequest(
      OAUTH_URL,
      { grant_type: 'password' },
      { deadline: Date.now() + 20_000 },
    );
    req.emit('timeout');

    await expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(req.destroy).toHaveBeenCalled();
  });

  it('clamps the socket timeout to the per-attempt ceiling', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation(() => req);

    const promise: Promise<any> = (newService() as any).makeGetRequest(
      GET_URL,
      'tok',
      { deadline: Date.now() + 20_000 },
    );
    req.emit('timeout');
    await expect(promise).rejects.toBeDefined();

    expect(requestMock.mock.calls[0][0].timeout).toBe(6_000);
  });

  it('clamps the socket timeout DOWN to whatever budget is left', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation(() => req);

    const promise: Promise<any> = (newService() as any).makeGetRequest(
      GET_URL,
      'tok',
      { deadline: Date.now() + 2_000 },
    );
    req.emit('timeout');
    await expect(promise).rejects.toBeDefined();

    expect(requestMock.mock.calls[0][0].timeout).toBeLessThanOrEqual(2_000);
  });

  it('does the same clamping for the OAuth POST', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation(() => req);

    const promise: Promise<any> = (newService() as any).makePostRequest(
      OAUTH_URL,
      { grant_type: 'password' },
      { deadline: Date.now() + 1_500 },
    );
    req.emit('timeout');
    await expect(promise).rejects.toBeDefined();

    expect(requestMock.mock.calls[0][0].timeout).toBeLessThanOrEqual(1_500);
  });

  it('still carries the real upstream status and body on a non-2xx', async () => {
    const req = fakeRequest();
    requestMock.mockImplementation((_opts: any, cb: any) => {
      const res: any = new EventEmitter();
      res.statusCode = 502;
      process.nextTick(() => {
        cb(res);
        res.emit('data', Buffer.from('upstream connect error'));
        res.emit('end');
      });
      return req;
    });

    await expect(
      (newService() as any).makeGetRequest(GET_URL, 'tok', {
        deadline: Date.now() + 20_000,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});
