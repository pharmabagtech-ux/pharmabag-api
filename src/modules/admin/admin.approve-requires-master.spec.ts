import { BadRequestException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { AdminService } from './admin.service';

/**
 * Approving a listing with no master product made it active but not buyable.
 *
 * Sellers used to be able to create listings for products that are not in the
 * catalogue; those rows landed as approvalStatus PENDING, isActive false and
 * nobody reviewed them. create() now refuses to make new ones, but the backlog
 * is deliberately left in the database rather than migrated — so the one thing
 * that must not happen is an admin approving one into visibility.
 *
 * It would not even work: approveProduct sets isActive true, but the storefront
 * grid queries MasterProduct and joins listings, so an unlinked row stays
 * invisible to buyers however it is flagged. The fix for such a product is to
 * add it to the catalogue and have the seller list it against that.
 */

const makeService = (product: any) => {
  const updated: any[] = [];

  const prisma: any = {
    product: {
      findUnique: async () => product,
      update: async (args: any) => {
        updated.push(args);
        return { id: 'product-1', name: 'X', isActive: true };
      },
    },
  };

  // AdminService(prisma, notificationsService, storage) — approveProduct touches
  // only prisma, so the other two are stand-ins.
  const noop: any = {};

  return { service: new AdminService(prisma, noop, noop), updated };
};

describe('AdminService.approveProduct — approval requires a catalogue product', () => {
  it('refuses a listing with no master product', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(service.approveProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });

  it('says what to do instead', async () => {
    const { service } = makeService({
      id: 'product-1',
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(service.approveProduct('product-1')).rejects.toThrow(
      /catalogue/s,
    );
  });

  it('still approves a listing that is linked to the catalogue', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await service.approveProduct('product-1');

    expect(updated).toHaveLength(1);
    expect(updated[0].data.approvalStatus).toBe(ProductApprovalStatus.APPROVED);
    expect(updated[0].data.isActive).toBe(true);
  });
});
