import { Module } from '@nestjs/common';
import { MulticardClient } from '../payments/multicard.client';
import { CheckoutService } from './checkout.service';
import { SeatsService } from './seats.service';
import { WalletService } from './wallet.service';

/** Booking va Payments modullari o'rtasidagi umumiy yadro (aylanma bog'liqliksiz). */
@Module({
  providers: [SeatsService, WalletService, CheckoutService, MulticardClient],
  exports: [SeatsService, WalletService, CheckoutService, MulticardClient],
})
export class CommerceModule {}
