import { Module } from '@nestjs/common';
import { AdminHostPayoutsController } from './host-payouts.controller';
import { AdminHostPayoutsService } from './host-payouts.service';

/** Admin: haftalik host payout'lari (ro'yxat, CSV, "to'landi"). */
@Module({
  controllers: [AdminHostPayoutsController],
  providers: [AdminHostPayoutsService],
})
export class AdminHostPayoutsModule {}
