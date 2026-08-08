import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { CreateBrokerDto } from './dto/create-broker.dto';
import { UpdateBrokerDto } from './dto/update-broker.dto';
import { Broker } from '@prisma/client';

@Injectable()
export class BrokersService {
  private readonly logger = new Logger('BrokersService');
  
  // Tracks active connection sessions by Broker UUID
  private readonly activeConnections = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(dto: CreateBrokerDto, operatorId: string, ipAddress?: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'CONNECTED' | 'DISCONNECTED' }> {
    const encryptedPassword = this.cryptoService.encrypt(dto.password);

    const broker = await this.prisma.broker.create({
      data: {
        name: dto.name,
        serverAddress: dto.serverAddress,
        port: dto.port,
        managerLogin: dto.managerLogin,
        encryptedPassword,
      },
    });

    await this.logAction(
      operatorId,
      'CREATE_BROKER',
      `Created broker connection: ${broker.name} (${broker.serverAddress}:${broker.port})`,
      ipAddress,
    );

    const { encryptedPassword: _, ...safeBroker } = broker;
    return {
      ...safeBroker,
      status: 'DISCONNECTED',
    };
  }

  async findAll(): Promise<(Omit<Broker, 'encryptedPassword'> & { status: 'CONNECTED' | 'DISCONNECTED' })[]> {
    const brokers = await this.prisma.broker.findMany({
      select: {
        id: true,
        name: true,
        serverAddress: true,
        port: true,
        managerLogin: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return brokers.map((broker) => ({
      ...broker,
      status: this.activeConnections.get(broker.id) ? 'CONNECTED' : 'DISCONNECTED',
    }));
  }

  async findOne(id: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'CONNECTED' | 'DISCONNECTED' }> {
    const broker = await this.prisma.broker.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        serverAddress: true,
        port: true,
        managerLogin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    return {
      ...broker,
      status: this.activeConnections.get(broker.id) ? 'CONNECTED' : 'DISCONNECTED',
    };
  }

  async findOneWithCredentials(id: string, operatorId: string, ipAddress?: string): Promise<Broker & { decryptedPassword: string }> {
    const broker = await this.prisma.broker.findUnique({
      where: { id },
    });

    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    await this.logAction(
      operatorId,
      'DECRYPT_BROKER_CREDS',
      `Decrypted credentials for broker connection: ${broker.name}`,
      ipAddress,
    );

    const decryptedPassword = this.cryptoService.decrypt(broker.encryptedPassword);
    return {
      ...broker,
      decryptedPassword,
    };
  }

  async update(id: string, dto: UpdateBrokerDto, operatorId: string, ipAddress?: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'CONNECTED' | 'DISCONNECTED' }> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    const updateData: any = {
      name: dto.name,
      serverAddress: dto.serverAddress,
      port: dto.port,
      managerLogin: dto.managerLogin,
    };

    if (dto.password) {
      updateData.encryptedPassword = this.cryptoService.encrypt(dto.password);
    }

    const updated = await this.prisma.broker.update({
      where: { id },
      data: updateData,
    });

    await this.logAction(
      operatorId,
      'UPDATE_BROKER',
      `Updated broker connection properties: ${updated.name}`,
      ipAddress,
    );

    const { encryptedPassword: _, ...safeBroker } = updated;
    return {
      ...safeBroker,
      status: this.activeConnections.get(updated.id) ? 'CONNECTED' : 'DISCONNECTED',
    };
  }

  async remove(id: string, operatorId: string, ipAddress?: string): Promise<void> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    await this.prisma.broker.delete({
      where: { id },
    });

    this.activeConnections.delete(id);

    await this.logAction(
      operatorId,
      'DELETE_BROKER',
      `Deleted broker connection: ${broker.name}`,
      ipAddress,
    );
  }

  // Simulates or contacts MT5 Connector to verify connection before saving
  async testConnection(serverAddress: string, port: number, managerLogin: string, passwordText: string): Promise<boolean> {
    this.logger.log(`Testing connection parameters for ${serverAddress}:${port}`);
    
    // Simulate API request delay to MT5 Connector service
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Simulated simple logic: reject empty addresses or localhost port 0
    if (!serverAddress || port <= 0 || !managerLogin || !passwordText) {
      throw new BadRequestException('Invalid MT5 credentials or connection properties');
    }

    // In a real environment, we would invoke an HTTP request to the MT5 Connector.
    // For now, simulate a successful connection response.
    return true;
  }

  // Tests connection of an already saved broker profile
  async testSavedConnection(id: string, operatorId: string, ipAddress?: string): Promise<boolean> {
    const broker = await this.findOneWithCredentials(id, operatorId, ipAddress);
    return this.testConnection(
      broker.serverAddress,
      broker.port,
      broker.managerLogin,
      broker.decryptedPassword,
    );
  }

  // Connects a broker session
  async connect(id: string, operatorId: string, ipAddress?: string): Promise<boolean> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException('Broker connection not found');
    }

    // Verify connection parameters before connecting
    await this.testSavedConnection(id, operatorId, ipAddress);

    this.activeConnections.set(id, true);
    await this.logAction(
      operatorId,
      'CONNECT_BROKER',
      `Connected session to broker: ${broker.name}`,
      ipAddress,
    );

    return true;
  }

  // Disconnects a broker session
  async disconnect(id: string, operatorId: string, ipAddress?: string): Promise<boolean> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException('Broker connection not found');
    }

    this.activeConnections.set(id, false);
    await this.logAction(
      operatorId,
      'DISCONNECT_BROKER',
      `Disconnected session from broker: ${broker.name}`,
      ipAddress,
    );

    return true;
  }

  private async logAction(userId: string, action: string, details: string, ipAddress?: string) {
    this.logger.log(`Audit log: User ${userId} performed ${action} - ${details}`);
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress,
      },
    });
  }
}
