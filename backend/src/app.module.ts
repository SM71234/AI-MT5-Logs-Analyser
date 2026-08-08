import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { BrokersModule } from './brokers/brokers.module';
import { ClientsModule } from './clients/clients.module';
import { TradesModule } from './trades/trades.module';
import { JournalModule } from './journal/journal.module';
import { InvestigationsModule } from './investigations/investigations.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    BrokersModule,
    ClientsModule,
    TradesModule,
    JournalModule,
    InvestigationsModule,
    AiModule,
  ],
})
export class AppModule {}
