import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ClerkStrategy } from './clerk.strategy';

@Global()
@Module({
  controllers: [AuthController],
  providers: [ClerkStrategy],
  exports: [ClerkStrategy],
})
export class AuthModule {}
