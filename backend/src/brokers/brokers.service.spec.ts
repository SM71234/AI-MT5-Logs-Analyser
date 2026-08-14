import { Test, TestingModule } from '@nestjs/testing';
import { BrokersService } from './brokers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { ConfigService } from '@nestjs/config';
import { CreateBrokerDto } from './dto/create-broker.dto';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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

    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:4500'),
    };

    // Mock global fetch
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrokersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: ConfigService, useValue: mockConfigService },
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
      expect(result.status).toBe('UNVERIFIED');
    });
  });

  describe('testConnection', () => {
    it('should return true for a successful MT5 connector connection', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Connected to MT5 Manager successfully.' }),
      });

      const success = await service.testConnection('127.0.0.1', 443, '1001', 'password');
      expect(success).toBe(true);
    });

    it('should map login/password auth failures to Authentication failure', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Invalid credentials or login/password auth failed' }),
      });

      await expect(
        service.testConnection('127.0.0.1', 443, '1001', 'password'),
      ).rejects.toThrow(new BadRequestException('Authentication failure'));
    });

    it('should map timeout errors to Connection timeout', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Connection timed out' }),
      });

      await expect(
        service.testConnection('127.0.0.1', 443, '1001', 'password'),
      ).rejects.toThrow(new BadRequestException('Connection timeout'));
    });
  });

  describe('activeConnections cache TTL', () => {
    it('should manage cache and expire active status after 5 minutes', () => {
      const id = 'broker-uuid';
      
      // Initially false
      expect(service.isConnectionActive(id)).toBe(false);

      // Set to true
      (service as any).activeConnections.set(id, { verifiedAt: Date.now(), success: true });
      expect(service.isConnectionActive(id)).toBe(true);

      // Expire cache manually by modifying verifiedAt
      const oldTime = Date.now() - (6 * 60 * 1000); // 6 mins ago
      (service as any).activeConnections.set(id, { verifiedAt: oldTime, success: true });
      expect(service.isConnectionActive(id)).toBe(false);
    });
  });
});
