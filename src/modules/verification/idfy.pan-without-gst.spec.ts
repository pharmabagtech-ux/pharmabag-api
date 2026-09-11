import { IdfyService } from './idfy.service';

/**
 * Reported from live onboarding: a PAN belonging to someone with no GST
 * registration was rejected as "Pan Number is invalid", so individuals and
 * small businesses could not finish buyer or seller signup at all.
 *
 * The cause was two Masters India endpoints being confused for each other:
 *
 *   /searchpan  lists the GSTINs registered against a PAN. No GST
 *               registration means no rows — which the code read as a bad PAN.
 *   /pandetail  is the actual PAN check, and involves no GST at all.
 *
 * Only /searchpan was ever called.
 *
 * The two things these tests hold down together: a PAN that verifies today
 * must keep verifying identically, and a PAN with no GST must now pass.
 */

const CONFIGURED_ENV = {
  MASTERS_INDIA_CLIENT_ID: 'client-id',
  MASTERS_INDIA_CLIENT_SECRET: 'client-secret',
  MASTERS_INDIA_USERNAME: 'user',
  MASTERS_INDIA_PASSWORD: 'pass',
} as Record<string, string>;

/** A PAN that IS registered for GST — the case that works today. */
const SEARCHPAN_HIT = {
  error: false,
  data: [
    {
      gstin: '19CEWPR5040D1ZW',
      lgnm: 'RISHIRAJ RATERIA',
      sts: 'Active',
    },
  ],
};

/** The same endpoint when the PAN carries no GST registration. */
const SEARCHPAN_EMPTY = { error: false, data: [] };

/** /pandetail for a valid individual PAN with no GST behind it. */
const PANDETAIL_VALID = {
  error: false,
  data: {
    status: { statusCode: 200, statusMessage: 'PAN Verification Request Processed' },
    response: {
      number: 'CEWPR5040D',
      name: 'RISHIRAJ RATERIA',
      typeOfHolder: 'Individual',
      isIndividual: true,
      isValid: true,
      firstName: 'RISHIRAJ',
      middleName: '',
      lastName: 'RATERIA',
      title: 'Shri',
      panStatusCode: 'E',
      panStatus: 'VALID',
      aadhaarSeedingStatus: 'Linked',
      aadhaarSeedingStatusCode: 'Y',
      lastUpdatedOn: '16/07/2016',
    },
  },
};

const makeService = (responses: Record<string, any>) => {
  const service = new IdfyService({
    get: (key: string) => CONFIGURED_ENV[key],
  } as any);

  const calls: string[] = [];

  (service as any).getAccessToken = jest.fn().mockResolvedValue('token');
  (service as any).makeGetRequest = jest.fn((url: string) => {
    const endpoint = url.includes('/pandetail') ? 'pandetail' : 'searchpan';
    calls.push(endpoint);

    const result = responses[endpoint];
    if (result === undefined) {
      return Promise.reject(new Error('Masters India API HTTP 404: not found'));
    }
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  });

  return { service, calls };
};

describe('verifyPan — a PAN with no GST registration', () => {
  it('is accepted, where it used to be reported as invalid', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: PANDETAIL_VALID,
    });

    const result = await service.verifyPan('CEWPR5040D');

    expect(result.status).toBe(true);
    expect(result.legalName).toBe('RISHIRAJ RATERIA');
    expect(result.message).toBe('Pan Number is valid');
    expect(result.verifiedDocumentType).toBe('ind_pan');
  });

  it('does not invent a GST number for a PAN that has none', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: PANDETAIL_VALID,
    });

    const result = await service.verifyPan('CEWPR5040D');

    // An empty string here would land in the buyer's GST field.
    expect(result.gstNumber).toBeUndefined();
  });

  it('still checks the PAN when the GST lookup errors rather than returning empty', async () => {
    const { service, calls } = makeService({
      searchpan: new Error('Masters India API HTTP 404: no records'),
      pandetail: PANDETAIL_VALID,
    });

    const result = await service.verifyPan('CEWPR5040D');

    expect(calls).toEqual(['searchpan', 'pandetail']);
    expect(result.status).toBe(true);
  });

  it('builds a name from the parts when no full name is given', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: {
        error: false,
        data: {
          response: {
            isValid: true,
            panStatus: 'VALID',
            firstName: 'RISHIRAJ',
            middleName: 'KUMAR',
            lastName: 'RATERIA',
          },
        },
      },
    });

    expect((await service.verifyPan('CEWPR5040D')).legalName).toBe(
      'RISHIRAJ KUMAR RATERIA',
    );
  });
});

describe('verifyPan — PANs that work today must keep working identically', () => {
  it('returns the GST legal name and linked GSTIN, and never reaches the PAN endpoint', async () => {
    const { service, calls } = makeService({
      searchpan: SEARCHPAN_HIT,
      pandetail: PANDETAIL_VALID,
    });

    const result = await service.verifyPan('CEWPR5040D');

    expect(result).toEqual({
      status: true,
      legalName: 'RISHIRAJ RATERIA',
      gstNumber: '19CEWPR5040D1ZW',
      message: 'Pan Number is valid',
      verifiedDocumentType: 'ind_pan',
    });
    // The GST registry answered, so no second call is made and no second
    // billable lookup is spent.
    expect(calls).toEqual(['searchpan']);
  });

  it('reports an unconfigured service exactly as before', async () => {
    const service = new IdfyService({ get: () => undefined } as any);

    const result = await service.verifyPan('CEWPR5040D');

    expect(result).toEqual({
      status: false,
      message: 'Verification service not configured',
      verifiedDocumentType: null,
    });
  });
});

describe('verifyPan — a PAN that really is bad is still rejected', () => {
  it('rejects when neither endpoint can confirm it', async () => {
    const { service, calls } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: { error: true, data: null },
    });

    const result = await service.verifyPan('ZZZZZ9999Z');

    expect(calls).toEqual(['searchpan', 'pandetail']);
    expect(result.status).toBe(false);
    expect(result.message).toBe('Pan Number is invalid');
  });

  it('rejects a PAN record that exists but is not valid', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: {
        error: false,
        data: {
          response: {
            number: 'CEWPR5040D',
            name: 'SOMEONE',
            isValid: false,
            panStatus: 'INVALID',
          },
        },
      },
    });

    expect((await service.verifyPan('CEWPR5040D')).status).toBe(false);
  });

  it('rejects a deactivated PAN', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: {
        error: false,
        data: { response: { name: 'SOMEONE', panStatus: 'DEACTIVATED' } },
      },
    });

    expect((await service.verifyPan('CEWPR5040D')).status).toBe(false);
  });

  it('rejects when both endpoints fail outright', async () => {
    const { service } = makeService({
      searchpan: new Error('HTTP 500'),
      pandetail: new Error('HTTP 500'),
    });

    const result = await service.verifyPan('CEWPR5040D');

    expect(result.status).toBe(false);
    expect(result.message).toBe('Pan Number is invalid');
  });

  it('does not treat an empty PAN details payload as a pass', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: { error: false, data: {} },
    });

    expect((await service.verifyPan('CEWPR5040D')).status).toBe(false);
  });
});

describe('verifyPan — input handling', () => {
  it('upper-cases and trims before calling out', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_HIT,
      pandetail: PANDETAIL_VALID,
    });

    await service.verifyPan('  cewpr5040d  ');

    const url = ((service as any).makeGetRequest as jest.Mock).mock.calls[0][0];
    expect(url).toContain('pan=CEWPR5040D');
  });

  it('never writes a full PAN into the logs', async () => {
    const { service } = makeService({
      searchpan: SEARCHPAN_EMPTY,
      pandetail: PANDETAIL_VALID,
    });

    const logged: string[] = [];
    (service as any).logger = {
      log: (m: string) => logged.push(m),
      warn: (m: string) => logged.push(m),
      error: (m: string) => logged.push(m),
    };

    await service.verifyPan('CEWPR5040D');

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('CEWPR5040D');
    }
  });
});
