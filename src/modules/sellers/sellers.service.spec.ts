import { BadRequestException } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';

/**
 * Seller onboarding accepts EITHER GST or PAN (the portal shows them as
 * "GST ... OR ... PAN"). A PAN-only seller must be able to complete onboarding,
 * and must be verified against PAN rather than silently left UNVERIFIED.
 */
const baseDto = {
  companyName: 'The Era of Marketing',
  drugLicenseNumber: 'DL-WB-123456',
  drugLicenseUrl: 'https://s3.amazonaws.com/dl1.pdf',
  drugLicenseNumber2: 'DL-WB-654321',
  drugLicenseUrl2: 'https://s3.amazonaws.com/dl2.pdf',
  address: '86, Jamuna Apartment, Golaghata Road',
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700048',
} as CreateSellerProfileDto;

const makeService = () => {
  const created: any[] = [];
  const prisma = {
    sellerProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 'seller-1', ...data });
      }),
    },
  };
  const idfy = {
    isConfigured: jest.fn().mockReturnValue(true),
    verifyGst: jest.fn().mockResolvedValue({
      status: true,
      legalName: 'The Era of Marketing',
      message: 'GST Number is valid',
    }),
    verifyPan: jest.fn().mockResolvedValue({
      status: true,
      legalName: 'RISHIRAJ RATERIA',
      message: 'Pan Number is valid',
    }),
  };
  const service = new SellersService(prisma as any, idfy as any);
  return { service, prisma, idfy, created };
};

describe('SellersService.createProfile — GST or PAN', () => {
  it('creates a profile from PAN alone and verifies against PAN', async () => {
    const { service, idfy, created } = makeService();

    const profile = await service.createProfile('user-1', {
      ...baseDto,
      panNumber: 'CEWPR5040D',
    });

    expect(idfy.verifyPan).toHaveBeenCalledWith('CEWPR5040D');
    expect(idfy.verifyGst).not.toHaveBeenCalled();
    expect(created[0].panNumber).toBe('CEWPR5040D');
    expect(created[0].gstNumber).toBe(''); // column is NOT NULL
    expect(profile.verificationStatus).toBe('PENDING');
  });

  it('creates a profile from GST alone and verifies against GST', async () => {
    const { service, idfy, created } = makeService();

    await service.createProfile('user-1', {
      ...baseDto,
      gstNumber: '19CEWPR5040D1Z3',
    });

    expect(idfy.verifyGst).toHaveBeenCalledWith('19CEWPR5040D1Z3');
    expect(idfy.verifyPan).not.toHaveBeenCalled();
    expect(created[0].panNumber).toBe('');
  });

  it('prefers GST when both are supplied', async () => {
    const { service, idfy } = makeService();

    await service.createProfile('user-1', {
      ...baseDto,
      gstNumber: '19CEWPR5040D1Z3',
      panNumber: 'CEWPR5040D',
    });

    expect(idfy.verifyGst).toHaveBeenCalled();
    expect(idfy.verifyPan).not.toHaveBeenCalled();
  });

  it('rejects a profile with neither GST nor PAN', async () => {
    const { service, prisma } = makeService();

    await expect(service.createProfile('user-1', { ...baseDto })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.sellerProfile.create).not.toHaveBeenCalled();
  });

  it('blocks creation when PAN verification fails', async () => {
    const { service, idfy, prisma } = makeService();
    idfy.verifyPan.mockResolvedValue({
      status: false,
      message: 'Pan Number is invalid',
    });

    await expect(
      service.createProfile('user-1', { ...baseDto, panNumber: 'CEWPR5040D' }),
    ).rejects.toThrow('Pan Number is invalid');
    expect(prisma.sellerProfile.create).not.toHaveBeenCalled();
  });
});
