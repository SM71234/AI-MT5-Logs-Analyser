import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { Mt5Module } from '../mt5/mt5.module';

@Module({
  imports: [Mt5Module],
  controllers: [ClientsController],
})
export class ClientsModule {}
