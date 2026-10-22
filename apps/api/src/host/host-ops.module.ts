import { Module } from '@nestjs/common';
import { OpsAlerts } from '../common/ops-alerts';
import { HostNoShowAlerts, HostPayouts } from './host-ops.service';

/** Host operatsiyalari job'lari (JobsService chaqiradi): no-show ogohlantirishi va haftalik payout. */
@Module({
  providers: [OpsAlerts, HostNoShowAlerts, HostPayouts],
  exports: [OpsAlerts, HostNoShowAlerts, HostPayouts],
})
export class HostOpsModule {}
