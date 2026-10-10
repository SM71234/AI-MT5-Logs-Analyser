import { Test, TestingModule } from '@nestjs/testing';
import { Mt5Service } from './mt5.service';
import { ConfigService } from '@nestjs/config';
import { BrokersService } from '../brokers/brokers.service';
import { MetricsService } from '../metrics/metrics.service';
import { BadGatewayException, NotFoundException, RequestTimeoutException } from '@nestjs/common';

describe('Mt5Service - Chunk 4 Reliability & Telemetry', () => {
  let service: Mt5Service;
  let brokersService: jest.Mocked<BrokersService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:4500'),
    };

    const mockBrokersService = {
      findOneWithCredentials: jest.fn().mockResolvedValue({
        id: 'broker-id',
        name: 'Reliable Broker',
        serverAddress: 'mt5.reliable.com',
        port: 443,
        managerLogin: 'manager',
        encryptedPassword: 'enc',
        decryptedPassword: 'dec',
      }),
    };

    const mockMetricsService = {
      analyzeExecution: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Mt5Service,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: BrokersService, useValue: mockBrokersService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<Mt5Service>(Mt5Service);
    brokersService = module.get(BrokersService) as any;

    global.fetch = jest.fn();
  });

  describe('Bounded Retries and Backoffs', () => {
    it('should retry read-only operations exactly 3 times on connection failure', async () => {
      // Mock fetch failing continuously with a network error
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network drop'));

      // Measure time to ensure we aren't waiting too long during tests
      const start = Date.now();
      
      await expect(
        service.getClientProfile('broker-id', '1001', 'operator-id'),
      ).rejects.toThrow(BadGatewayException);

      // Verify global fetch was called 3 times (the initial call + 2 retries)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should succeed on second retry attempt', async () => {
      // First call fails, second succeeds
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('First network drop'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ success: true, data: { login: '1001', name: 'Trader' } }),
        });

      const result = await service.getClientProfile('broker-id', '1001', 'operator-id');
      
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.name).toBe('Trader');
    });

    it('should NOT retry connection tests (testConnection)', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Server offline'));

      await expect(
        service.testConnection('mt5.reliable.com', 443, 'manager', 'password'),
      ).rejects.toThrow(BadGatewayException);

      // testConnection must be tried exactly once
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Structured Error Mapping', () => {
    it('should map CONNECTION_FAILED error to BadGatewayException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 502,
        headers: {
          get: () => 'application/json',
        },
        json: jest.fn().mockResolvedValue({
          success: false,
          error: {
            code: 'CONNECTION_FAILED',
            message: 'Broker connection lost',
          },
        }),
      });

      await expect(
        service.getClientProfile('broker-id', '1001', 'operator-id'),
      ).rejects.toThrow(BadGatewayException);

      try {
        await service.getClientProfile('broker-id', '1001', 'operator-id');
      } catch (err: any) {
        expect(err.getResponse().code).toBe('CONNECTION_FAILED');
        expect(err.getResponse().message).toBe('Broker connection lost');
      }
    });

    it('should map TIMEOUT error to RequestTimeoutException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 504,
        headers: {
          get: () => 'application/json',
        },
        json: jest.fn().mockResolvedValue({
          success: false,
          error: {
            code: 'TIMEOUT',
            message: 'LoggerServerRequest timed out after 30s',
          },
        }),
      });

      await expect(
        service.getClientProfile('broker-id', '1001', 'operator-id'),
      ).rejects.toThrow(RequestTimeoutException);

      try {
        await service.getClientProfile('broker-id', '1001', 'operator-id');
      } catch (err: any) {
        expect(err.getResponse().code).toBe('TIMEOUT');
        expect(err.getResponse().message).toBe('LoggerServerRequest timed out after 30s');
      }
    });
  });

  describe('Bounded Timeouts (AbortController)', () => {
    it('should abort request if it exceeds timeout limit', async () => {
      let controllerSignal: any = null;
      (global.fetch as jest.Mock).mockImplementation((url, init) => {
        controllerSignal = init.signal;
        return new Promise((resolve, reject) => {
          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The user aborted a request.');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      await expect(
        service.getClientProfile('broker-id', '1001', 'operator-id'),
      ).rejects.toThrow(RequestTimeoutException);

      expect(controllerSignal).toBeDefined();
      expect(controllerSignal?.aborted).toBe(true);
    });
  });
});
