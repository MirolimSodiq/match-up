import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';
import { SIGNING_KEYS, loadSigningKeys } from './keys';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: SIGNING_KEYS, inject: [ENV], useFactory: loadSigningKeys },
  ],
  exports: [ENV, SIGNING_KEYS],
})
export class ConfigModule {}
