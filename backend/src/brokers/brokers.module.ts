import { Module } from '@nestjs/common';
import { BrokersService } from './brokers.service';
import { BrokersController } from './brokers.controller';
import { CryptoService } from '../common/services/crypto.service';

@Module({
  providers: [BrokersService, CryptoService],
  controllers: [BrokersController],
  exports: [BrokersService],
})
export class BrokersModule {}
