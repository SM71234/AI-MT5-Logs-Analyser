import { Controller, Get, Query, UseGuards, Ip, HttpStatus, HttpCode } from '@nestjs/common';
import { Mt5Service } from '../mt5/mt5.service';
import { GetTradesDto } from './dto/get-trades.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';

@Controller('trades')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TradesController {
  constructor(private readonly mt5Service: Mt5Service) {}

  @Get()
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async getTrades(
    @Query() query: GetTradesDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const trades = await this.mt5Service.getClientTrades(
      query.brokerId,
      query.login,
      user.id,
      ipAddress,
    );

    return {
      message: 'Trades history retrieved successfully',
      data: trades,
    };
  }
}
