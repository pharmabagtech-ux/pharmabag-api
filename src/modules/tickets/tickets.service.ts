import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { Role } from '@prisma/client';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a support ticket. Any authenticated user can open one.
   * The first message is created together with the ticket.
   */
  async createTicket(userId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        userId,
        subject: dto.subject,
        messages: {
          create: {
            senderId: userId,
            message: dto.message,
          },
        },
      },
      include: {
        messages: {
          select: {
            id: true,
            senderId: true,
            message: true,
            createdAt: true,
          },
        },
      },
    });

    this.logger.log(`Ticket created: ${ticket.id} by user ${userId}`);
    return ticket;
  }

  /**
   * Get tickets. Buyers/Sellers see only their own; Admins see all.
   */
  async getTickets(userId: string, role: Role) {
    const where = role === Role.ADMIN ? {} : { userId };

    const tickets = await this.prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            phone: true,
            role: true,
          },
        },
        _count: { select: { messages: true } },
      },
    });

    return tickets;
  }

  /**
   * Add a message to a ticket.
   * - Ticket owner can always add messages.
   * - Admin can add messages to any ticket.
   */
  async addMessage(
    userId: string,
    role: Role,
    ticketId: string,
    dto: CreateMessageDto,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Only the ticket owner or an admin can post messages
    if (ticket.userId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Reopen ticket if it was resolved/closed and the user adds a message
    const shouldReopen =
      (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') &&
      ticket.userId === userId;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          ticketId,
          senderId: userId,
          message: dto.message,
        },
        select: {
          id: true,
          senderId: true,
          message: true,
          createdAt: true,
        },
      }),
      // Update ticket status based on who is replying
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: shouldReopen
            ? 'OPEN'
            : role === Role.ADMIN
              ? 'IN_PROGRESS'
              : undefined,
        },
      }),
    ]);

    this.logger.log(`Message added to ticket ${ticketId} by user ${userId}`);
    return message;
  }
}
