import { Test, TestingModule } from '@nestjs/testing';
import { BrokersService } from './brokers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { CreateBrokerDto } from './dto/create-broker.dto';
import { NotFoundException } from '@nestjs/common';

describe('BrokersService', () => {
  let service: BrokersService;
  let prisma: any;
  let cryptoService: jest.Mocked<CryptoService>;

  beforeEach(async () => {
    const mockPrismaService = {
      broker: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    const mockCryptoService = {
      encrypt: jest.fn((text) => `encrypted:${text}`),
      decrypt: jest.fn((cipher) => cipher.replace('encrypted:', '')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrokersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CryptoService, useValue: mockCryptoService },
      ],
    }).compile();

    service = module.get<BrokersService>(BrokersService);
    prisma = module.get(PrismaService);
    cryptoService = module.get(CryptoService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should encrypt broker password and store configuration, recording audit logs', async () => {
      const dto: CreateBrokerDto = {
        name: 'Alpha Broker',
        serverAddress: 'mt5.alphabroker.com',
        port: 443,
        managerLogin: 'manager1',
        password: 'superpassword',
      };

      const createdBroker = {
        id: 'broker-uuid',
        ...dto,
        encryptedPassword: 'encrypted:superpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.broker.create.mockResolvedValue(createdBroker);
      prisma.auditLog.create.mockResolvedValue({ id: 'log-id' } as any);

      const result = await service.create(dto, 'operator-uuid', '127.0.0.1');

      expect(cryptoService.encrypt).toHaveBeenCalledWith('superpassword');
      expect(prisma.broker.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          serverAddress: dto.serverAddress,
          port: dto.port,
          managerLogin: dto.managerLogin,
          encryptedPassword: 'encrypted:superpassword',
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'operator-uuid',
          action: 'CREATE_BROKER',
          details: expect.stringContaining('Alpha Broker'),
          ipAddress: '127.0.0.1',
        },
      });
      expect(result).not.toHaveProperty('encryptedPassword');
      expect(result.id).toBe('broker-uuid');
      expect(result.status).toBe('DISCONNECTED');
    });
  });

  describe('connect and disconnect', () => {
    it('should establish an active session connection, updating audit logs', async () => {
      const storedBroker = {
        id: 'broker-uuid',
        name: 'Beta Broker',
        serverAddress: 'mt5.betabroker.com',
        port: 443,
        managerLogin: 'manager2',
        encryptedPassword: 'encrypted:stored_pass',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.broker.findUnique.mockResolvedValue(storedBroker);
      prisma.auditLog.create.mockResolvedValue({ id: 'log-id' } as any);

      const connected = await service.connect('broker-uuid', 'operator-uuid', '127.0.0.1');
      expect(connected).toBe(true);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'operator-uuid',
          action: 'CONNECT_BROKER',
          details: expect.stringContaining('Beta Broker'),
          ipAddress: '127.0.0.1',
        },
      });

      // Disconnect
      const disconnected = await service.disconnect('broker-uuid', 'operator-uuid', '127.0.0.1');
      expect(disconnected).toBe(true);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'operator-uuid',
          action: 'DISCONNECT_BROKER',
          details: expect.stringContaining('Beta Broker'),
          ipAddress: '127.0.0.1',
        },
      });
    });

    it('should throw NotFoundException if broker connection profile is missing on connect', async () => {
      prisma.broker.findUnique.mockResolvedValue(null);

      await expect(
        service.connect('missing-uuid', 'operator-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
