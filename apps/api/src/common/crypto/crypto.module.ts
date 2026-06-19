import { Module } from '@nestjs/common';
import { CryptoService, CRYPTO_KEY } from './crypto.service';

@Module({
  providers: [
    CryptoService,
    {
      provide: CRYPTO_KEY,
      useFactory: () => {
        const k = process.env.SECRET_ENCRYPTION_KEY;
        if (!k) throw new Error('SECRET_ENCRYPTION_KEY is required for SNMP');
        return Buffer.from(k, 'base64');
      },
    },
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
