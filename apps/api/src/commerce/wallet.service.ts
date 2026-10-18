import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, type Db, type Executor, one, rows } from '../db/db';

type WalletTxnType = 'refund_credit' | 'booking_debit' | 'promo_credit' | 'adjustment' | 'expiry';

/** Ichki hamyon: balans + append-only ledger (wallet_transactions). */
@Injectable()
export class WalletService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async balance(userId: string, currency: string, ex: Executor = this.db): Promise<number> {
    const r = await one<{ balance: number }>(
      ex,
      sql`SELECT balance FROM wallet_accounts WHERE user_id = ${userId} AND currency = ${currency}`,
    );
    return r?.balance ?? 0;
  }

  /** Asosiy valyuta: shahar valyutasi -> davlat valyutasi -> UZS. */
  async primaryCurrency(userId: string, ex: Executor = this.db): Promise<string> {
    const r = await one<{ currency: string }>(
      ex,
      sql`SELECT coalesce(ci.default_currency, co.default_currency, 'UZS') AS currency
          FROM users u
          LEFT JOIN cities ci ON ci.id = u.home_city_id
          LEFT JOIN countries co ON co.code = u.country_code
          WHERE u.id = ${userId}`,
    );
    return r?.currency ?? 'UZS';
  }

  /** Barcha valyutalardagi balanslar: asosiy valyuta birinchi (hamyon hali ochilmagan bo'lsa 0). */
  async balances(userId: string, ex: Executor = this.db): Promise<{ currency: string; balance: number }[]> {
    const primary = await this.primaryCurrency(userId, ex);
    const others = await rows<{ currency: string; balance: number }>(
      ex,
      sql`SELECT currency, balance FROM wallet_accounts WHERE user_id = ${userId} AND currency <> ${primary} ORDER BY currency`,
    );
    return [{ currency: primary, balance: await this.balance(userId, primary, ex) }, ...others];
  }

  async credit(
    ex: Executor,
    p: { userId: string; currency: string; amount: number; type: WalletTxnType; bookingId?: string; refundId?: string; note?: string },
  ): Promise<number> {
    if (p.amount <= 0) throw new Error('credit: musbat summa kerak');
    await ex.execute(
      sql`INSERT INTO wallet_accounts (user_id, currency) VALUES (${p.userId}, ${p.currency})
          ON CONFLICT (user_id, currency) DO NOTHING`,
    );
    const acc = await one<{ id: string; balance: number }>(
      ex,
      sql`UPDATE wallet_accounts SET balance = balance + ${p.amount}, updated_at = now()
          WHERE user_id = ${p.userId} AND currency = ${p.currency}
          RETURNING id, balance`,
    );
    await this.ledger(ex, acc!.id, p.type, p.amount, acc!.balance, p);
    return acc!.balance;
  }

  /** Atomik debit: balans yetmasa WALLET_INSUFFICIENT (balans hech qachon manfiy bo'lmaydi). */
  async debit(
    ex: Executor,
    p: { userId: string; currency: string; amount: number; type: WalletTxnType; bookingId?: string; note?: string },
  ): Promise<number> {
    const acc = await one<{ id: string; balance: number }>(
      ex,
      sql`UPDATE wallet_accounts SET balance = balance - ${p.amount}, updated_at = now()
          WHERE user_id = ${p.userId} AND currency = ${p.currency} AND balance >= ${p.amount}
          RETURNING id, balance`,
    );
    if (!acc) throw new AppError('WALLET_INSUFFICIENT');
    await this.ledger(ex, acc.id, p.type, -p.amount, acc.balance, p);
    return acc.balance;
  }

  private async ledger(
    ex: Executor,
    walletId: string,
    type: WalletTxnType,
    amount: number,
    balanceAfter: number,
    p: { bookingId?: string; refundId?: string; note?: string },
  ) {
    await ex.execute(
      sql`INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, booking_id, refund_id, note)
          VALUES (${walletId}, ${type}, ${amount}, ${balanceAfter}, ${p.bookingId ?? null}, ${p.refundId ?? null}, ${p.note ?? null})`,
    );
  }
}
