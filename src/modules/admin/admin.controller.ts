import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users/pending')
  @HttpCode(HttpStatus.OK)
  async getPendingUsers() {
    const data = await this.adminService.getPendingUsers();
    return { message: 'Pending users retrieved successfully', data };
  }

  @Patch('users/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveUser(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.approveUser(id);
    return { message: 'User approved successfully', data };
  }

  @Patch('users/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectUser(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.rejectUser(id);
    return { message: 'User rejected successfully', data };
  }
}
