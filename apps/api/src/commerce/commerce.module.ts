import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { SeatsService } from './seats.service';
import { WalletService } from './wallet.service';

/** Booking va Payments modullari o'rtasidagi umumiy yadro (aylanma bog'liqliksiz). */
@Module({
  providers: [SeatsService, WalletService, CheckoutService],
  exports: [SeatsService, WalletService, CheckoutService],
})
export class CommerceModule {}
