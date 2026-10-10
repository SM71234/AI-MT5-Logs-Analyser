import { Injectable, Logger, BadGatewayException, NotFoundException, RequestTimeoutException } from '@nestjs/common';
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
    this.connectorUrl = this.configService.get<string>('MT5_CONNECTOR_URL', 'http://127.0.0.1:4500');
  }

  // Helper with 30s timeout, bounded 3-retry attempt policy, and exponential backoff
  private async fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 1000): Promise<Response> {
    const isTest = process.env.NODE_ENV === 'test';
    const timeoutLimit = isTest ? 100 : 30000;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutLimit);
      
      try {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal as any,
        });
        
        if (res.ok) {
          return res;
        }
        
        if (res.status === 404) {
          // Do not retry NotFound 404
          return res;
        }
        
        let errorBody: any = null;
        try {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            errorBody = await res.json();
          }
        } catch {}
        
        if (errorBody && errorBody.error) {
          const errCode = errorBody.error.code;
          const errMsg = errorBody.error.message;
          
          if (errCode === 'INVALID_REQUEST') {
            return res; // don't retry invalid parameters
          }
          
          if (attempt === retries) {
            if (res.status === 504 || errCode === 'TIMEOUT') {
              throw new RequestTimeoutException({
                code: 'TIMEOUT',
                message: errMsg || 'Connector operation timed out',
              });
            }
            throw new BadGatewayException({
              code: errCode || 'CONNECTION_FAILED',
              message: errMsg || 'Failed to communicate with MT5 Connector',
            });
          }
        } else {
          if (attempt === retries) {
            throw new BadGatewayException(`Connector returned HTTP ${res.status}`);
          }
        }
      } catch (error) {
        if (attempt === retries) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new RequestTimeoutException({
              code: 'TIMEOUT',
              message: `Connector operation timed out (${timeoutLimit}ms limit)`,
            });
          }
          if (error instanceof BadGatewayException || error instanceof RequestTimeoutException || error instanceof NotFoundException) {
            throw error;
          }
          throw new BadGatewayException({
            code: 'CONNECTION_FAILED',
            message: error instanceof Error ? error.message : 'Failed to communicate with MT5 Connector',
          });
        }
      } finally {
        clearTimeout(timeoutId);
      }
      
      const actualDelay = isTest ? 0 : delay * attempt;
      await new Promise((resolve) => setTimeout(resolve, actualDelay));
    }
    throw new BadGatewayException('All retry attempts failed');
  }

  // Proxies connection parameters check to the MT5 connector
  async testConnection(serverAddress: string, port: number, managerLogin: string, passwordText: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(`${this.connectorUrl}/api/v1/connector/test-connection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverAddress, port, managerLogin, password: passwordText }),
          signal: controller.signal as any,
        });

        if (!res.ok) {
          return false;
        }
        const body = await res.json();
        return body.success;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      this.logger.error('Failed to communicate with MT5 Connector service', error);
      throw new BadGatewayException('MT5 Connector service is unreachable');
    }
  }

  // Fetches client details by login ID
  async getClientProfile(brokerId: string, login: string, operatorId: string, ipAddress?: string): Promise<any> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress, false);
    
    this.logger.log(`Fetching client profile for login #${login} on broker: ${broker.name}`);

    const res = await this.fetchWithRetry(`${this.connectorUrl}/api/v1/connector/users/${login}`, {
      headers: {
        'x-mt5-server': broker.serverAddress,
        'x-mt5-port': broker.port.toString(),
        'x-mt5-login': broker.managerLogin,
        'x-mt5-password': broker.decryptedPassword,
      },
    });

    if (res.status === 404) {
      throw new NotFoundException(`Client login #${login} not found on broker server`);
    }

    const body = await res.json();
    return body.data;
  }

  // Fetches client trade list
  async getClientTrades(
    brokerId: string,
    login: string,
    operatorId: string,
    ipAddress?: string,
    from?: string,
    to?: string,
  ): Promise<any[]> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress, false);

    this.logger.log(`Fetching client trades for login #${login} on broker: ${broker.name} (range: ${from || 'default'} to ${to || 'default'})`);

    let url = `${this.connectorUrl}/api/v1/connector/users/${login}/trades`;
    const queryParams = new URLSearchParams();
    if (from) queryParams.append('from_ts', from);
    if (to) queryParams.append('to_ts', to);
    const queryString = queryParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const res = await this.fetchWithRetry(url, {
      headers: {
        'x-mt5-server': broker.serverAddress,
        'x-mt5-port': broker.port.toString(),
        'x-mt5-login': broker.managerLogin,
        'x-mt5-password': broker.decryptedPassword,
      },
    });

    const body = await res.json();
    const rawTrades = body.data || [];
    return rawTrades.map((trade: any) => {
      const entryParam = trade.entry ? {
        ...trade.entry,
        totalObservableExecutionTimeMs: trade.entry.totalObservableExecutionTimeMs ?? trade.entry.latencyMs,
      } : null;
      const exitParam = trade.exit ? {
        ...trade.exit,
        totalObservableExecutionTimeMs: trade.exit.totalObservableExecutionTimeMs ?? trade.exit.latencyMs,
      } : null;

      const analysis = this.metricsService.analyzeExecution(entryParam, exitParam);
      return {
        ...trade,
        executionAnalysis: analysis,
      };
    });
  }

  // Fetches raw client journals
  async getClientJournal(
    brokerId: string,
    login: string,
    operatorId: string,
    ipAddress?: string,
    from?: number,
    to?: number,
  ): Promise<string[]> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress, false);

    this.logger.log(`Fetching client journals for login #${login} on broker: ${broker.name} (range: ${from ?? 'default'} to ${to ?? 'default'})`);

    let url = `${this.connectorUrl}/api/v1/connector/users/${login}/journal`;
    const queryParams = new URLSearchParams();
    if (from !== undefined) queryParams.append('from_ts', from.toString());
    if (to !== undefined) queryParams.append('to_ts', to.toString());
    const queryString = queryParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const res = await this.fetchWithRetry(url, {
      headers: {
        'x-mt5-server': broker.serverAddress,
        'x-mt5-port': broker.port.toString(),
        'x-mt5-login': broker.managerLogin,
        'x-mt5-password': broker.decryptedPassword,
      },
    });

    const body = await res.json();
    return body.data;
  }

  // Fetches symbol specifications (digits, point size, tick size, calc mode, currency, and source label)
  async getSymbolSpecs(
    brokerId: string,
    symbol: string,
    operatorId: string,
    ipAddress?: string,
  ): Promise<{
    symbol: string;
    digits: number;
    point: number;
    tickSize?: number;
    tickValue?: number;
    contractSize?: number;
    tradeCalcMode?: string;
    currency?: string;
    source: 'MT5_SERVER' | 'CONFIG' | 'HEURISTIC' | 'UNKNOWN';
  }> {
    const broker = await this.brokersService.findOneWithCredentials(brokerId, operatorId, ipAddress, false);

    this.logger.log(`Fetching symbol specs for ${symbol} on broker: ${broker.name}`);

    try {
      const res = await this.fetchWithRetry(`${this.connectorUrl}/api/v1/connector/symbols/${symbol}`, {
        headers: {
          'x-mt5-server': broker.serverAddress,
          'x-mt5-port': broker.port.toString(),
          'x-mt5-login': broker.managerLogin,
          'x-mt5-password': broker.decryptedPassword,
        },
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.data?.digits !== undefined && body?.data?.point !== undefined) {
          return {
            symbol,
            digits: body.data.digits,
            point: body.data.point,
            tickSize: body.data.tickSize ?? body.data.point,
            tickValue: body.data.tickValue ?? 1.0,
            contractSize: body.data.contractSize ?? 100000,
            tradeCalcMode: body.data.tradeCalcMode ?? 'FOREX',
            currency: body.data.currency ?? 'USD',
            source: 'MT5_SERVER',
          };
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch symbol specs for ${symbol} from MT5 connector, falling back to heuristics`, error);
    }

    // Heuristic Fallback
    const isJpyOrMetal = symbol.toUpperCase().includes('JPY') ||
                        symbol.toUpperCase().includes('XAU') ||
                        symbol.toUpperCase().includes('GOLD') ||
                        symbol.toUpperCase().includes('XAG') ||
                        symbol.toUpperCase().includes('SILVER');

    const digits = isJpyOrMetal ? 2 : 5;
    const point = isJpyOrMetal ? 0.01 : 0.00001;

    return {
      symbol,
      digits,
      point,
      tickSize: point,
      tickValue: 1.0,
      contractSize: symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD') ? 100 : 100000,
      tradeCalcMode: isJpyOrMetal && !symbol.toUpperCase().includes('JPY') ? 'CFD' : 'FOREX',
      currency: 'USD',
      source: 'HEURISTIC',
    };
  }
}
