import { Test, TestingModule } from '@nestjs/testing';
import { Mt5Service } from './mt5.service';
import { ConfigService } from '@nestjs/config';
import { BrokersService } from '../brokers/brokers.service';
import { NotFoundException, BadGatewayException } from '@nestjs/common';

describe('Mt5Service', () => {
  let service: Mt5Service;
  let brokersService: jest.Mocked<BrokersService>;
  
  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:4500'),
    };

    const mockBrokersService = {
      findOneWithCredentials: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Mt5Service,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: BrokersService, useValue: mockBrokersService },
      ],
    }).compile();

    service = module.get<Mt5Service>(Mt5Service);
    brokersService = module.get(BrokersService) as any;

    // Reset global fetch mock
    global.fetch = jest.fn();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getClientProfile', () => {
    it('should successfully fetch client profile from connector', async () => {
      const mockProfile = {
        login: '1001',
        name: 'Normal Trader',
        balance: 10000,
        currency: 'USD',
      };

      brokersService.findOneWithCredentials.mockResolvedValue({
        id: 'broker-id',
        name: 'Alpha Broker',
        serverAddress: 'mt5.alphabroker.com',
        port: 443,
        managerLogin: 'manager',
        encryptedPassword: 'enc',
        decryptedPassword: 'dec',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: true, data: mockProfile }),
      });

      const result = await service.getClientProfile('broker-id', '1001', 'operator-id');

      expect(brokersService.findOneWithCredentials).toHaveBeenCalledWith('broker-id', 'operator-id', undefined);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4500/api/v1/connector/users/1001',
        {
          headers: {
            'x-mt5-server': 'mt5.alphabroker.com',
            'x-mt5-port': '443',
            'x-mt5-login': 'manager',
            'x-mt5-password': 'dec',
          },
        },
      );
      expect(result).toEqual(mockProfile);
    });

    it('should throw NotFoundException if client does not exist on MT5', async () => {
      brokersService.findOneWithCredentials.mockResolvedValue({
        id: 'broker-id',
        name: 'Alpha Broker',
        serverAddress: 'mt5.alphabroker.com',
        port: 443,
        managerLogin: 'manager',
        encryptedPassword: 'enc',
        decryptedPassword: 'dec',
      } as any);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({ success: false, message: 'Not found' }),
      });

      await expect(
        service.getClientProfile('broker-id', '9999', 'operator-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadGatewayException if connector fails', async () => {
      brokersService.findOneWithCredentials.mockResolvedValue({
        id: 'broker-id',
        name: 'Alpha Broker',
        serverAddress: 'mt5.alphabroker.com',
        port: 443,
        managerLogin: 'manager',
        encryptedPassword: 'enc',
        decryptedPassword: 'dec',
      } as any);

      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(
        service.getClientProfile('broker-id', '1001', 'operator-id'),
      ).rejects.toThrow(BadGatewayException);
    });
  });
});
