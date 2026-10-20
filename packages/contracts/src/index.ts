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
export type Wallet = Schemas['Wallet'];
export type DataSubjectRequest = Schemas['DataSubjectRequest'];
export type ErasureBlockedReason = Schemas['ErasureBlockedReason'];
export type PersonalDataExport = Schemas['PersonalDataExport'];
export type AuthIdentity = Schemas['AuthIdentity'];
export type SocialCredential = Schemas['SocialCredential'];
export type SocialProvider = SocialCredential['provider'];

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

// --- Admin panel ------------------------------------------------------------
export type Translations = Schemas['Translations'];
export type UserRef = Schemas['UserRef'];
export type CurrencyTotal = Schemas['CurrencyTotal'];
export type Surface = Schemas['Surface'];
export type PaymentStatus = Schemas['PaymentStatus'];
export type HostStatus = Schemas['HostStatus'];
export type AdminReference = Schemas['AdminReference'];
export type AdminPitch = Schemas['AdminPitch'];
export type AdminPitchCreate = Schemas['AdminPitchCreate'];
export type AdminPitchUpdate = Schemas['AdminPitchUpdate'];
export type AdminVenue = Schemas['AdminVenue'];
export type AdminVenueCreate = Schemas['AdminVenueCreate'];
export type AdminVenueUpdate = Schemas['AdminVenueUpdate'];
export type AdminVenueList = Schemas['AdminVenueList'];
export type AdminMatchCreate = Schemas['AdminMatchCreate'];
export type AdminMatch = Schemas['AdminMatch'];
export type AdminMatchList = Schemas['AdminMatchList'];
export type AdminMatchDetail = Schemas['AdminMatchDetail'];
export type AdminHost = Schemas['AdminHost'];
export type AdminHostCreate = Schemas['AdminHostCreate'];
export type AdminHostUpdate = Schemas['AdminHostUpdate'];
export type AdminHostList = Schemas['AdminHostList'];
export type AdminPayment = Schemas['AdminPayment'];
export type AdminPaymentList = Schemas['AdminPaymentList'];
export type AdminRefund = Schemas['AdminRefund'];
export type AdminRefundList = Schemas['AdminRefundList'];
export type AdminDashboard = Schemas['AdminDashboard'];
export type AdminCancelMatch = NonNullable<operations['adminCancelMatch']['requestBody']>['content']['application/json'];
export type AdminCompleteRefund = NonNullable<operations['adminCompleteRefund']['requestBody']>['content']['application/json'];
export type AdminSuspendHost = NonNullable<operations['adminSuspendHost']['requestBody']>['content']['application/json'];
