import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Ip,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ChatFollowupDto } from './dto/chat-followup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';

@Controller('investigations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvestigationsController {
  constructor(private readonly investigationsService: InvestigationsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateInvestigationDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const caseFile = await this.investigationsService.create(dto, user.id, ipAddress);
    return {
      message: 'Investigation case saved successfully',
      data: caseFile,
    };
  }

  @Get()
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async findAll() {
    const cases = await this.investigationsService.findAll();
    return {
      message: 'Saved cases retrieved successfully',
      data: cases,
    };
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    const caseFile = await this.investigationsService.findOne(id);
    return {
      message: 'Case file details retrieved successfully',
      data: caseFile,
    };
  }

  @Post(':id/notes')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.CREATED)
  async addNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const note = await this.investigationsService.addNote(id, dto, user.id, ipAddress);
    return {
      message: 'Casework note added successfully',
      data: note,
    };
  }

  @Post(':id/analyze')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Param('id') id: string,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const report = await this.investigationsService.analyze(id, user.id, ipAddress);
    return {
      message: 'AI Incident analysis completed successfully',
      data: report,
    };
  }

  @Post(':id/chat')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async chat(
    @Param('id') id: string,
    @Body() dto: ChatFollowupDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const answer = await this.investigationsService.chat(id, dto, user.id, ipAddress);
    return {
      message: 'AI response completed successfully',
      data: { answer },
    };
  }
}
