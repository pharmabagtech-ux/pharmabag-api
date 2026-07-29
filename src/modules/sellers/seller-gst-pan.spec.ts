import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';

/**
 * Seller onboarding accepts EITHER GST or PAN.
 *
 * The seller portal shows "GST Number ... OR ... PAN Number", but the DTO
 * required both, so a seller who verified only their PAN could never submit.
 * The buyer side already behaves this way (buyers.service.ts) — this pins the
 * same contract for sellers.
 */
const baseProfile = {
  companyName: 'The Era of Marketing',
  drugLicenseNumber: 'DL-WB-123456',
  drugLicenseUrl: 'https://s3.amazonaws.com/dl1.pdf',
  drugLicenseNumber2: 'DL-WB-654321',
  drugLicenseUrl2: 'https://s3.amazonaws.com/dl2.pdf',
  address: '86, Jamuna Apartment, Golaghata Road',
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700048',
};

const errorsFor = async (payload: Record<string, any>) => {
  const dto = plainToInstance(CreateSellerProfileDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
};

describe('CreateSellerProfileDto — GST or PAN', () => {
  it('accepts PAN only (no GST)', async () => {
    const failed = await errorsFor({ ...baseProfile, panNumber: 'CEWPR5040D' });
    expect(failed).not.toContain('gstNumber');
    expect(failed).toHaveLength(0);
  });

  it('accepts GST only (no PAN)', async () => {
    const failed = await errorsFor({
      ...baseProfile,
      gstNumber: '19CEWPR5040D1Z3',
    });
    expect(failed).not.toContain('panNumber');
    expect(failed).toHaveLength(0);
  });

  it('accepts both GST and PAN together', async () => {
    const failed = await errorsFor({
      ...baseProfile,
      gstNumber: '19CEWPR5040D1Z3',
      panNumber: 'CEWPR5040D',
    });
    expect(failed).toHaveLength(0);
  });

  it('still rejects a malformed GST when one is supplied', async () => {
    const failed = await errorsFor({ ...baseProfile, gstNumber: 'NOT-A-GSTIN' });
    expect(failed).toContain('gstNumber');
  });

  it('still rejects a malformed PAN when one is supplied', async () => {
    const failed = await errorsFor({ ...baseProfile, panNumber: '123' });
    expect(failed).toContain('panNumber');
  });
});
