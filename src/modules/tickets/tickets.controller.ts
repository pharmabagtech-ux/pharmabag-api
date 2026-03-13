import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * POST /api/tickets — Create a support ticket (any authenticated user)
   */
  @Post()
  createTicket(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTicketDto,
  ) {
    return this.ticketsService.createTicket(userId, dto);
  }

  /**
   * GET /api/tickets — Get tickets (own tickets for buyer/seller, all for admin)
   */
  @Get()
  getTickets(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: any,
  ) {
    return this.ticketsService.getTickets(userId, role);
  }

  /**
   * POST /api/tickets/:id/messages — Add a message to a ticket
   */
  @Post(':id/messages')
  addMessage(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: any,
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.ticketsService.addMessage(userId, role, ticketId, dto);
  }
}
