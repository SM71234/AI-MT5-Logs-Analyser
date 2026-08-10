import { Injectable, Logger, BadGatewayException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokersService } from '../brokers/brokers.service';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class Mt5Service {
  private readonly logger = new Logger('Mt5Service');
  private readonly connectorUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly brokersService: BrokersService,
    private readonly metricsService: MetricsService,
  ) {
    this.connectorUrl = this.configService.get<string>('MT5_CONNECTOR_URL', 'http://localhost:4500');
  }

  // Proxies connection parameters check to the MT5 connector
  async testConnection(serverAddress: string, port: number, managerLogin: string, passwordText: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.connectorUrl}/api/v1/connector/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverAddress, port, managerLogin, password: passwordText }),
      });

      if (!res.ok) {
        return false;
      }
      const body = await res.json();
      return body.success;
    } catch (error) {
      this.logger.error('Failed to communicate with MT5 Connector service', error);
      throw new BadGatewayException('MT5 Connector service is unreachable');
    }
  }

  // Fetches client details by login ID
  async getClientProfile(brokerId: string, login: string, operatorId: string, ipAddress?: string): Promise<any> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress);
    
    this.logger.log(`Fetching client profile for login #${login} on broker: ${broker.name}`);

    try {
      const res = await fetch(`${this.connectorUrl}/api/v1/connector/users/${login}`, {
        headers: {
          'x-mt5-server': broker.serverAddress,
          'x-mt5-port': broker.port.toString(),
          'x-mt5-login': broker.managerLogin,
          'x-mt5-password': broker.decryptedPassword,
        },
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new NotFoundException(`Client login #${login} not found on broker server`);
        }
        throw new Error('Connector returned error');
      }

      const body = await res.json();
      return body.data;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to fetch client profile for #${login}`, error);
      throw new BadGatewayException('Failed to communicate with MT5 Connector');
    }
  }

  // Fetches client trade list
  async getClientTrades(brokerId: string, login: string, operatorId: string, ipAddress?: string): Promise<any[]> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress);

    this.logger.log(`Fetching client trades for login #${login} on broker: ${broker.name}`);

    try {
      const res = await fetch(`${this.connectorUrl}/api/v1/connector/users/${login}/trades`, {
        headers: {
          'x-mt5-server': broker.serverAddress,
          'x-mt5-port': broker.port.toString(),
          'x-mt5-login': broker.managerLogin,
          'x-mt5-password': broker.decryptedPassword,
        },
      });
      if (!res.ok) {
        throw new Error('Connector returned error');
      }

      const body = await res.json();
      const rawTrades = body.data || [];
      return rawTrades.map((trade: any) => {
        const analysis = this.metricsService.analyzeExecution(trade.entry, trade.exit);
        return {
          ...trade,
          executionAnalysis: analysis,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch client trades for #${login}`, error);
      throw new BadGatewayException('Failed to communicate with MT5 Connector');
    }
  }

  // Fetches raw client journals
  async getClientJournal(brokerId: string, login: string, operatorId: string, ipAddress?: string): Promise<string[]> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress);

    this.logger.log(`Fetching client journals for login #${login} on broker: ${broker.name}`);

    try {
      const res = await fetch(`${this.connectorUrl}/api/v1/connector/users/${login}/journal`, {
        headers: {
          'x-mt5-server': broker.serverAddress,
          'x-mt5-port': broker.port.toString(),
          'x-mt5-login': broker.managerLogin,
          'x-mt5-password': broker.decryptedPassword,
        },
      });
      if (!res.ok) {
        throw new Error('Connector returned error');
      }

      const body = await res.json();
      return body.data;
    } catch (error) {
      this.logger.error(`Failed to fetch client journals for #${login}`, error);
      throw new BadGatewayException('Failed to communicate with MT5 Connector');
    }
  }

  // Fetches symbol specifications (digits, point size)
  async getSymbolSpecs(
    brokerId: string,
    symbol: string,
    operatorId: string,
    ipAddress?: string,
  ): Promise<{ digits: number | null; point: number | null }> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress);

    this.logger.log(`Fetching symbol specs for ${symbol} on broker: ${broker.name}`);

    try {
      const res = await fetch(`${this.connectorUrl}/api/v1/connector/symbols/${symbol}`, {
        headers: {
          'x-mt5-server': broker.serverAddress,
          'x-mt5-port': broker.port.toString(),
          'x-mt5-login': broker.managerLogin,
          'x-mt5-password': broker.decryptedPassword,
        },
      });
      if (!res.ok) {
        throw new Error('Connector returned error');
      }

      const body = await res.json();
      return body.data;
    } catch (error) {
      this.logger.error(`Failed to fetch symbol specs for ${symbol}`, error);
      return { digits: null, point: null };
    }
  }
}
