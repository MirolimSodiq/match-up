/**
 * Match Up API kontrakti — `api/openapi.yaml` dan generatsiya qilingan tiplar.
 *
 * `schema.ts` ni qo'lda o'zgartirmang: spetsifikatsiya o'zgarsa `pnpm --filter @matchup/contracts generate`.
 */
export type { components, operations, paths } from './schema';

import type { components, operations } from './schema';

type Schemas = components['schemas'];

export type Problem = Schemas['Problem'];
export type Money = Schemas['Money'];
export type GeoPoint = Schemas['GeoPoint'];
export type SkillLevel = Schemas['SkillLevel'];
export type PaymentProvider = Schemas['PaymentProvider'];
export type DeviceInfo = Schemas['DeviceInfo'];
export type Tokens = Schemas['Tokens'];
export type User = Schemas['User'];
export type UserUpdate = Schemas['UserUpdate'];
export type SportProfile = Schemas['SportProfile'];
export type ConsentPurpose = Schemas['ConsentPurpose'];
export type ConsentInput = Schemas['ConsentInput'];
export type VenueSummary = Schemas['VenueSummary'];
export type MatchStatus = Schemas['MatchStatus'];
export type MatchSummary = Schemas['MatchSummary'];
export type MatchDetail = Schemas['MatchDetail'];
export type WaiverTemplate = Schemas['WaiverTemplate'];
export type BookingCreate = Schemas['BookingCreate'];
export type BookingStatus = Schemas['BookingStatus'];
export type Booking = Schemas['Booking'];
export type Checkout = Schemas['Checkout'];

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

export type AuthSuccess = Json<components['responses']['AuthSuccess']>;
export type City = Json<operations['listCities']['responses'][200]>[number];
export type Sport = Json<operations['listSports']['responses'][200]>[number];
export type RequiredWaiver = Json<operations['getRequiredWaiver']['responses'][200]>;
export type PaymentMethods = Json<operations['listPaymentMethods']['responses'][200]>;
export type CreateBookingResult = Json<operations['createBooking']['responses'][201]>;
export type CancelBookingResult = Json<operations['cancelBooking']['responses'][200]>;
export type Refund = NonNullable<CancelBookingResult['refund']>;
export type Ticket = NonNullable<Json<operations['getTicket']['responses'][200]>['tickets']>[number];
