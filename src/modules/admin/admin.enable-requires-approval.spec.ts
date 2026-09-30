import { BadRequestException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { AdminService } from './admin.service';

/**
 * enableProduct is the third door onto the same room approveProduct already
 * guards (commit 283face): it also flips isActive to true, but it only ever
 * checked "does this product exist and is it already active" — nothing about
 * whether the listing is linked to the catalogue or has actually been vetted.
 *
 * That meant an admin (or anything scripting the /enable endpoint) could
 * activate an orphan listing with no MasterProduct, which the storefront
 * grid can never surface regardless of isActive — the exact defect
 * approveProduct was fixed for, reached through a different verb. It could
 * also activate a PENDING or REJECTED listing directly, skipping approval
 * entirely: "enable" is meant to re-activate something already approved
 * (e.g. after a disable), not a second way to publish it for the first time.
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

  // AdminService(prisma, notificationsService, storage) — enableProduct touches
  // only prisma, so the other two are stand-ins.
  const noop: any = {};

  return { service: new AdminService(prisma, noop, noop), updated };
};

describe('AdminService.enableProduct — enabling requires prior approval', () => {
  it('refuses an orphan listing with no master product', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.APPROVED as ProductApprovalStatus,
      isActive: false,
    });

    await expect(service.enableProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });

  it('refuses a pending listing even when linked to the catalogue', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.PENDING as ProductApprovalStatus,
      isActive: false,
    });

    await expect(service.enableProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });

  it('refuses a rejected listing even when linked to the catalogue', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.REJECTED as ProductApprovalStatus,
      isActive: false,
    });

    await expect(service.enableProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });

  it('says to approve it instead', async () => {
    const { service } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.PENDING as ProductApprovalStatus,
      isActive: false,
    });

    await expect(service.enableProduct('product-1')).rejects.toThrow(/approve/i);
  });

  it('still enables an approved listing linked to the catalogue', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.APPROVED as ProductApprovalStatus,
      isActive: false,
    });

    await service.enableProduct('product-1');

    expect(updated).toHaveLength(1);
    expect(updated[0].data.isActive).toBe(true);
  });

  it('still rejects a product that is already active', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.APPROVED as ProductApprovalStatus,
      isActive: true,
    });

    await expect(service.enableProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });
});
