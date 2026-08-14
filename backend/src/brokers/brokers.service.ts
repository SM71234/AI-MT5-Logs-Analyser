import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { ConfigService } from '@nestjs/config';
import { CreateBrokerDto } from './dto/create-broker.dto';
import { UpdateBrokerDto } from './dto/update-broker.dto';
import { Broker } from '@prisma/client';

interface ConnectionCacheEntry {
  verifiedAt: number;
  success: boolean;
}

@Injectable()
export class BrokersService {
  private readonly logger = new Logger('BrokersService');
  
  // Tracks active connection sessions with verification timestamp
  private readonly activeConnections = new Map<string, ConnectionCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  isConnectionActive(id: string): boolean {
    const conn = this.activeConnections.get(id);
    if (!conn) return false;

    const fiveMinutesMs = 5 * 60 * 1000;
    const isValid = Date.now() - conn.verifiedAt < fiveMinutesMs;
    if (!isValid) {
      this.activeConnections.delete(id);
      return false;
    }
    return conn.success;
  }

  async create(dto: CreateBrokerDto, operatorId: string, ipAddress?: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'ACTIVE' | 'UNVERIFIED' }> {
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
      status: 'UNVERIFIED',
    };
  }

  async findAll(): Promise<(Omit<Broker, 'encryptedPassword'> & { status: 'ACTIVE' | 'UNVERIFIED' })[]> {
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
      status: this.isConnectionActive(broker.id) ? 'ACTIVE' : 'UNVERIFIED',
    }));
  }

  async findOne(id: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'ACTIVE' | 'UNVERIFIED' }> {
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
      status: this.isConnectionActive(broker.id) ? 'ACTIVE' : 'UNVERIFIED',
    };
  }

  async findOneWithCredentials(
    id: string,
    operatorId: string,
    ipAddress?: string,
    logAudit = false,
  ): Promise<Broker & { decryptedPassword: string }> {
    const broker = await this.prisma.broker.findUnique({
      where: { id },
    });

    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    if (logAudit) {
      await this.logAction(
        operatorId,
        'DECRYPT_BROKER_CREDS',
        `Operator explicitly decrypted/viewed credentials for broker connection: ${broker.name}`,
        ipAddress,
      );
    }

    const decryptedPassword = this.cryptoService.decrypt(broker.encryptedPassword);
    return {
      ...broker,
      decryptedPassword,
    };
  }

  async update(id: string, dto: UpdateBrokerDto, operatorId: string, ipAddress?: string): Promise<Omit<Broker, 'encryptedPassword'> & { status: 'ACTIVE' | 'UNVERIFIED' }> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException(`Broker connection not found`);
    }

    // Invalidate session on credential updates
    this.activeConnections.delete(id);

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
      status: this.isConnectionActive(updated.id) ? 'ACTIVE' : 'UNVERIFIED',
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
    this.logger.log(`Testing MT5 Connector connection for ${serverAddress}:${port}`);
    
    if (!serverAddress || port <= 0 || !managerLogin || !passwordText) {
      throw new BadRequestException('Invalid MT5 credentials or connection properties');
    }

    const connectorUrl = this.configService.get<string>('MT5_CONNECTOR_URL', 'http://localhost:4500');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const res = await fetch(`${connectorUrl}/api/v1/connector/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverAddress, port, managerLogin, password: passwordText }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 404) {
          throw new BadRequestException('Connector endpoint not found');
        }
        throw new BadRequestException(`MT5 Connector returned status ${res.status}`);
      }

      const body = await res.json();
      if (!body.success) {
        const errMsg = body.message || 'Unknown connection error';
        if (errMsg.includes('timeout') || errMsg.includes('timed out')) {
          throw new BadRequestException('Connection timeout');
        }
        if (errMsg.includes('auth') || errMsg.includes('login') || errMsg.includes('password') || errMsg.includes('credentials')) {
          throw new BadRequestException('Authentication failure');
        }
        if (errMsg.includes('dns') || errMsg.includes('host') || errMsg.includes('address') || errMsg.includes('server') || errMsg.includes('failed to connect')) {
          throw new BadRequestException('Server unavailable');
        }
        throw new BadRequestException(`Connection failure: ${errMsg}`);
      }

      // Automatically store in cache on successful manual test-connection
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new BadRequestException('Connection timeout');
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Failed to communicate with MT5 Connector service', error.message);
      if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
        throw new BadRequestException('Connector unavailable');
      }
      throw new BadRequestException(`Unexpected connector error: ${error.message}`);
    }
  }

  // Tests connection of an already saved broker profile
  async testSavedConnection(id: string, operatorId: string, ipAddress?: string): Promise<boolean> {
    const broker = await this.findOneWithCredentials(id, operatorId, ipAddress, false);
    try {
      const success = await this.testConnection(
        broker.serverAddress,
        broker.port,
        broker.managerLogin,
        broker.decryptedPassword,
      );
      
      await this.logAction(
        operatorId,
        'BROKER_CONNECTION_TEST',
        `Tested saved broker connection: ${broker.name}`,
        ipAddress,
      );

      if (success) {
        this.activeConnections.set(id, { verifiedAt: Date.now(), success: true });
      }
      
      return success;
    } catch (error) {
      throw error;
    }
  }

  // Connects a broker session after checking connection correctly
  async connect(id: string, operatorId: string, ipAddress?: string): Promise<boolean> {
    const broker = await this.prisma.broker.findUnique({ where: { id } });
    if (!broker) {
      throw new NotFoundException('Broker connection not found');
    }

    // Run connection verification check first
    await this.testSavedConnection(id, operatorId, ipAddress);

    this.activeConnections.set(id, { verifiedAt: Date.now(), success: true });

    await this.logAction(
      operatorId,
      'CONNECT_BROKER',
      `Established active session connection for broker: ${broker.name}`,
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

    this.activeConnections.delete(id);

    await this.logAction(
      operatorId,
      'DISCONNECT_BROKER',
      `Disconnected session from broker: ${broker.name}`,
      ipAddress,
    );

    return true;
  }

  async logAction(userId: string, action: string, details: string, ipAddress?: string) {
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
