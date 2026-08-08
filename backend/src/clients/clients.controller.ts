import { Controller, Get, Query, UseGuards, Ip, HttpStatus, HttpCode } from '@nestjs/common';
import { Mt5Service } from '../mt5/mt5.service';
import { SearchClientDto } from './dto/search-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly mt5Service: Mt5Service) {}

  @Get('search')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async searchClient(
    @Query() query: SearchClientDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const profile = await this.mt5Service.getClientProfile(
      query.brokerId,
      query.login,
      user.id,
      ipAddress,
    );

    return {
      message: 'Client profile retrieved successfully',
      data: profile,
    };
  }
}
