import { Module } from '@nestjs/common';
import { TradesController } from './trades.controller';
import { Mt5Module } from '../mt5/mt5.module';

@Module({
  imports: [Mt5Module],
  controllers: [TradesController],
})
export class TradesModule {}
