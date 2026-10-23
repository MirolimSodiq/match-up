import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { WalletService } from '../commerce/wallet.service';
import { emit } from '../common/outbox';
import { one, rows, type Tx } from '../db/db';

export interface PendingRefund {
  id: string;
  booking_id: string;
  payment_id: string;
  amount: number;
  currency: string;
  user_id: string;
}

/**
 * Provider refund'ini hisobga yozish — avto-refund job'i, Payme `CancelTransaction`, Uzum `/reverse` va
 * admin amallari bir xil qoidadan foydalanadi: yakunlangan har bir refund — `RefundIssued` (o'yinchiga push).
 */
@Injectable()
export class RefundSettlement {
  constructor(private readonly wallet: WalletService) {}

  /** To'lov bo'yicha kutilayotgan `original_method` refund'lari (lock bilan, eng eskisi birinchi). */
  pending(tx: Tx, paymentId: string): Promise<PendingRefund[]> {
    return rows<PendingRefund>(
      tx,
      sql`SELECT r.id, r.booking_id, r.payment_id, r.amount, r.currency, b.user_id
          FROM refunds r JOIN bookings b ON b.id = r.booking_id
          WHERE r.payment_id = ${paymentId} AND r.status = 'pending' AND r.destination = 'original_method'
          ORDER BY r.created_at, r.id
          FOR UPDATE OF r`,
    );
  }

  /**
   * Provider to'lovni to'liq bekor qildi (Payme CancelTransaction, Uzum reverse yoki avto-refund): kutilayotgan
   * refund'lar yakunlanadi; ulardan ortgan summa (refund so'ralmagan — masalan to'lov provider kabinetidan
   * o'zicha bekor qilingan) — `provider_cancel` refund'i. To'lov: refunded_amount = amount, status = refunded.
   */
  async providerReversed(tx: Tx, paymentId: string, providerRefundId: string): Promise<void> {
    const pay = await one<{ amount: number; refunded_amount: number; booking_id: string; currency: string }>(
      tx,
      sql`SELECT amount, refunded_amount, booking_id, currency FROM payments WHERE id = ${paymentId} FOR UPDATE`,
    );
    let remaining = pay!.amount - pay!.refunded_amount;
    for (const r of await this.pending(tx, paymentId)) {
      await this.complete(tx, r, providerRefundId);
      remaining -= r.amount;
    }
    if (remaining > 0) {
      await tx.execute(
        sql`INSERT INTO refunds (payment_id, booking_id, amount, currency, destination, status, reason, provider_refund_id, completed_at)
            VALUES (${paymentId}, ${pay!.booking_id}, ${remaining}, ${pay!.currency}, 'original_method', 'succeeded',
                    'provider_cancel', ${providerRefundId}, now())`,
      );
    }
    await tx.execute(
      sql`UPDATE payments SET refunded_amount = amount, status = 'refunded', cancelled_at = coalesce(cancelled_at, now())
          WHERE id = ${paymentId}`,
    );
  }

  /** Refund provider orqali qaytarildi: succeeded + provider_refund_id. payments jadvaliga chaqiruvchi yozadi. */
  async complete(tx: Tx, r: PendingRefund, providerRefundId: string, opts: { processedBy?: string; note?: string } = {}) {
    await tx.execute(
      sql`UPDATE refunds
             SET status = 'succeeded', provider_refund_id = ${providerRefundId}, completed_at = now(),
                 processed_by = ${opts.processedBy ?? null}, note = coalesce(${opts.note ?? null}, note),
                 auto_status = CASE WHEN auto_status = 'manual' THEN auto_status END, auto_next_at = NULL
           WHERE id = ${r.id}`,
    );
    await emit(tx, 'refund', r.id, 'RefundIssued', {
      booking_id: r.booking_id,
      payment_id: r.payment_id,
      amount: r.amount,
      destination: 'original_method',
      provider_refund_id: providerRefundId,
    });
  }

  /** Admin qarori: kartaga qaytarib bo'lmaydigan refund (masalan qisman) hamyonga o'tkaziladi. */
  async toWallet(tx: Tx, r: PendingRefund, processedBy: string, note: string | null) {
    await tx.execute(
      sql`UPDATE refunds
             SET destination = 'wallet', status = 'succeeded', completed_at = now(), processed_by = ${processedBy},
                 note = coalesce(${note}, note), auto_next_at = NULL
           WHERE id = ${r.id}`,
    );
    await this.wallet.credit(tx, {
      userId: r.user_id,
      currency: r.currency,
      amount: r.amount,
      type: 'refund_credit',
      bookingId: r.booking_id,
      refundId: r.id,
    });
    await emit(tx, 'refund', r.id, 'RefundIssued', { booking_id: r.booking_id, amount: r.amount, destination: 'wallet' });
  }
}
