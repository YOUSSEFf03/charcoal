import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';

import { HealthController } from './health/health.controller';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UsersModule } from './users/users.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { BagTypesModule } from './bag-types/bag-types.module';
import { BagPurchasesModule } from './bag-purchases/bag-purchases.module';
import { CashHandoversModule } from './cash-handovers/cash-handovers.module';
import { ContainersModule } from './containers/containers.module';
import { StockLotsModule } from './stock-lots/stock-lots.module';
import { StockAdjustmentsModule } from './stock-adjustments/stock-adjustments.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { PackingSessionsModule } from './packing-sessions/packing-sessions.module';
import { PackedStockModule } from './packed-stock/packed-stock.module';
import { ClientsModule } from './clients/clients.module';
import { OrdersModule } from './orders/orders.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { DriverTripsModule } from './driver-trips/driver-trips.module';
import { StockExitsModule } from './stock-exits/stock-exits.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { WorkersModule } from './workers/workers.module';
import { ReportsModule } from './reports/reports.module';
import { FillJobsModule } from './fill-jobs/fill-jobs.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
    }),
    PrismaModule,
    AuthModule,
    WebhooksModule,
    UsersModule,
    SuppliersModule,
    BagTypesModule,
    BagPurchasesModule,
    CashHandoversModule,
    ContainersModule,
    StockLotsModule,
    StockAdjustmentsModule,
    WarehouseModule,
    PackingSessionsModule,
    PackedStockModule,
    ClientsModule,
    OrdersModule,
    ShipmentsModule,
    DriverTripsModule,
    StockExitsModule,
    InvoicesModule,
    PaymentsModule,
    WorkersModule,
    ReportsModule,
    FillJobsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: JwtAuthGuard authenticates first, RolesGuard authorizes next.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
