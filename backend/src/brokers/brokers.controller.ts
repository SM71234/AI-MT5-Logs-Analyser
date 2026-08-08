import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Ip,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { BrokersService } from './brokers.service';
import { CreateBrokerDto } from './dto/create-broker.dto';
import { UpdateBrokerDto } from './dto/update-broker.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';

@Controller('brokers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BrokersController {
  constructor(private readonly brokersService: BrokersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createBrokerDto: CreateBrokerDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const broker = await this.brokersService.create(createBrokerDto, user.id, ipAddress);
    return {
      message: 'Broker connection configured successfully',
      data: broker,
    };
  }

  @Get()
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async findAll() {
    const brokers = await this.brokersService.findAll();
    return {
      message: 'Brokers list retrieved successfully',
      data: brokers,
    };
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    const broker = await this.brokersService.findOne(id);
    return {
      message: 'Broker configuration retrieved successfully',
      data: broker,
    };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateBrokerDto: UpdateBrokerDto,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const broker = await this.brokersService.update(id, updateBrokerDto, user.id, ipAddress);
    return {
      message: 'Broker configuration updated successfully',
      data: broker,
    };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    await this.brokersService.remove(id, user.id, ipAddress);
    return {
      message: 'Broker connection deleted successfully',
      data: null,
    };
  }

  @Post('test-connection')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async testConnection(@Body() dto: TestConnectionDto) {
    const isSuccess = await this.brokersService.testConnection(
      dto.serverAddress,
      dto.port,
      dto.managerLogin,
      dto.password,
    );
    return {
      success: isSuccess,
      message: isSuccess ? 'Connection parameters validated successfully' : 'Failed to validate connection parameters',
      data: { connected: isSuccess },
    };
  }

  @Post(':id/test-connection')
  @Roles(Role.ADMIN, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async testSavedConnection(
    @Param('id') id: string,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const isSuccess = await this.brokersService.testSavedConnection(id, user.id, ipAddress);
    return {
      success: isSuccess,
      message: isSuccess ? 'Connection to MT5 server validated successfully' : 'Failed to connect to MT5 server',
      data: { connected: isSuccess },
    };
  }

  @Post(':id/connect')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async connect(
    @Param('id') id: string,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const isSuccess = await this.brokersService.connect(id, user.id, ipAddress);
    return {
      success: isSuccess,
      message: 'Broker session established successfully',
      data: { connected: isSuccess },
    };
  }

  @Post(':id/disconnect')
  @Roles(Role.ADMIN, Role.DEALER, Role.SUPPORT, Role.RISK)
  @HttpCode(HttpStatus.OK)
  async disconnect(
    @Param('id') id: string,
    @GetUser() user: User,
    @Ip() ipAddress: string,
  ) {
    const isSuccess = await this.brokersService.disconnect(id, user.id, ipAddress);
    return {
      success: isSuccess,
      message: 'Broker session terminated successfully',
      data: { connected: !isSuccess },
    };
  }
}
