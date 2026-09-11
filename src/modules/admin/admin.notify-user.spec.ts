import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * The admin panel fires this on every user approval:
 *
 *   void sendUserNotification(userId, { title: "Account Verified!", ... })
 *
 * It posts to /admin/notifications/user/:userId, which did not exist — the
 * controller only had notifications/broadcast, notifications/broadcasts and
 * notifications/broadcasts/me. Every call 404'd, and because the caller wraps
 * it in a try/catch nothing ever looked broken. No approved buyer or seller
 * has ever received that notification.
 */

const makeService = (user: any = { id: 'user-1' }) => {
  const created: any[] = [];
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    notification: {
      create: jest.fn(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 'notification-1', ...data });
      }),
    },
  };

  const service = new AdminService(prisma as any, {} as any, {} as any);
  return { service, prisma, created };
};

describe('AdminService.notifyUser', () => {
  it('writes one notification for the user', async () => {
    const { service, created } = makeService();

    const result = await service.notifyUser('user-1', {
      message: 'Your business profile has been verified.',
    });

    expect(created).toEqual([
      { userId: 'user-1', message: 'Your business profile has been verified.' },
    ]);
    expect(result).toEqual({ success: true, notificationId: 'notification-1' });
  });

  it('accepts the title and type the admin panel sends, without storing them', async () => {
    // Rejecting the payload would break the existing caller. There is nowhere
    // to put them: the notifications table has only a message column.
    const { service, created } = makeService();

    await service.notifyUser('user-1', {
      title: 'Account Verified!',
      message: 'You can now place orders on PharmaBag.',
      type: 'verification',
    });

    expect(created[0]).toEqual({
      userId: 'user-1',
      message: 'You can now place orders on PharmaBag.',
    });
  });

  it('refuses to write a notification for a user that does not exist', async () => {
    const { service, prisma } = makeService(null);

    await expect(
      service.notifyUser('ghost', { message: 'hello' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
