import { Controller, Get, Query, UseGuards, Ip, HttpStatus, HttpCode, NotFoundException } from '@nestjs/common';
import { Mt5Service } from '../mt5/mt5.service';
import { GetJournalDto } from './dto/get-journal.dto';
import { GetIncidentDto } from './dto/get-incident.dto';
import { JournalEngineService } from './journal-engine.service';
import { MetricsService } from '../metrics/metrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';

@Controller('journals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JournalController {
  constructor(
    private readonly mt5Service: Mt5Service,
    private readonly journalEngineService: JournalEngineService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async getJournal(
    @Query() query: GetJournalDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const journal = await this.mt5Service.getClientJournal(
      query.brokerId,
      query.login,
      user.id,
      ipAddress,
    );

    return {
      message: 'Raw journals retrieved successfully',
      data: journal,
    };
  }

  @Get('incident')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async getIncidentTimeline(
    @Query() query: GetIncidentDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    // 1. Fetch raw logs associated with client login
    const rawLogs = await this.mt5Service.getClientJournal(
      query.brokerId,
      query.login,
      user.id,
      ipAddress,
    );

    // 2. Normalize and correlate logs into incident life-cycles
    const incidents = this.journalEngineService.processLogs(rawLogs);

    // 3. Find target incident matching ticket ID
    const targetIncident = incidents.find((i) => i.ticketId === query.ticket);
    if (!targetIncident) {
      throw new NotFoundException(`MT5 incident timeline not found for Ticket #${query.ticket}`);
    }

    // 4. Calculate deterministic execution metrics
    const metrics = this.metricsService.calculate(targetIncident);

    return {
      message: 'Incident timeline and metrics calculated successfully',
      data: {
        ticketId: targetIncident.ticketId,
        login: targetIncident.login,
        symbol: targetIncident.symbol,
        action: targetIncident.action,
        volume: targetIncident.volume,
        metrics,
        events: targetIncident.events,
      },
    };
  }
}
