// AUTO-GENERATED: `pnpm db:pull` (drizzle-kit pull + scripts/fix-drizzle-schema.ts). Qo'lda tahrirlamang —
// o'zgarishlar db/migrations/*.sql orqali kiritiladi.
import { geography, citext, bytea, tstzrange } from './custom-types';
import {
	type AnyPgColumn,
	bigint,
	boolean,
	char,
	check,
	date,
	foreignKey,
	index,
	inet,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	pgView,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const authProvider = pgEnum("auth_provider", ['phone', 'google', 'apple', 'telegram'])
export const bookingStatus = pgEnum("booking_status", ['pending_payment', 'confirmed', 'cancelled', 'expired', 'completed'])
export const bookingTarget = pgEnum("booking_target", ['match_slot', 'competition_entry'])
export const checkinAction = pgEnum("checkin_action", ['check_in', 'undo', 'no_show'])
export const checkinMethod = pgEnum("checkin_method", ['qr', 'manual'])
export const competitionStatus = pgEnum("competition_status", ['draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled'])
export const competitionType = pgEnum("competition_type", ['league', 'tournament', 'cup'])
export const consentPurpose = pgEnum("consent_purpose", ['terms_of_service', 'privacy_policy', 'marketing_sms', 'marketing_push', 'marketing_email', 'analytics', 'media_appearance', 'location_tracking'])
export const devicePlatform = pgEnum("device_platform", ['ios', 'android', 'web'])
export const dsrStatus = pgEnum("dsr_status", ['received', 'in_progress', 'completed', 'rejected', 'cancelled'])
export const dsrType = pgEnum("dsr_type", ['export', 'erasure', 'rectification', 'restriction'])
export const entryFeeMode = pgEnum("entry_fee_mode", ['per_team', 'per_player'])
export const entryStatus = pgEnum("entry_status", ['pending_payment', 'confirmed', 'withdrawn', 'disqualified'])
export const feedbackTarget = pgEnum("feedback_target", ['host', 'player', 'match', 'venue'])
export const genderValue = pgEnum("gender_value", ['male', 'female', 'other', 'undisclosed'])
export const highlightSource = pgEnum("highlight_source", ['host_manual', 'ai_generated', 'player_upload'])
export const highlightVisibility = pgEnum("highlight_visibility", ['public', 'participants', 'private'])
export const hostAssignmentStatus = pgEnum("host_assignment_status", ['offered', 'accepted', 'declined', 'expired', 'arrived', 'completed', 'no_show', 'cancelled'])
export const hostStatus = pgEnum("host_status", ['applicant', 'active', 'suspended', 'offboarded'])
export const leaseStatus = pgEnum("lease_status", ['reserved', 'confirmed', 'cancelled'])
export const matchEventSource = pgEnum("match_event_source", ['host', 'referee', 'ai'])
export const matchEventType = pgEnum("match_event_type", ['goal', 'own_goal', 'assist', 'yellow_card', 'red_card', 'save', 'mvp_vote', 'period_start', 'period_end'])
export const matchGenderPolicy = pgEnum("match_gender_policy", ['any', 'male', 'female', 'mixed'])
export const matchStatus = pgEnum("match_status", ['draft', 'open', 'full', 'in_progress', 'completed', 'cancelled'])
export const matchVisibility = pgEnum("match_visibility", ['public', 'unlisted', 'private'])
export const mediaKind = pgEnum("media_kind", ['video', 'image'])
export const mediaStatus = pgEnum("media_status", ['uploading', 'processing', 'ready', 'failed', 'rejected', 'deleted'])
export const moderationStatus = pgEnum("moderation_status", ['pending', 'approved', 'rejected'])
export const notificationChannel = pgEnum("notification_channel", ['push', 'sms', 'telegram', 'email', 'in_app'])
export const notificationStatus = pgEnum("notification_status", ['queued', 'sent', 'delivered', 'failed', 'read'])
export const participantSource = pgEnum("participant_source", ['booking', 'admin_invite', 'host_walk_in', 'team_roster'])
export const participantStatus = pgEnum("participant_status", ['held', 'confirmed', 'checked_in', 'no_show', 'cancelled', 'expired'])
export const paymentProvider = pgEnum("payment_provider", ['payme', 'click', 'uzum', 'stripe', 'paypal', 'wallet', 'manual'])
export const paymentStatus = pgEnum("payment_status", ['created', 'pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'])
export const payoutStatus = pgEnum("payout_status", ['pending', 'processing', 'paid', 'failed'])
export const processingJobStatus = pgEnum("processing_job_status", ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export const processingJobType = pgEnum("processing_job_type", ['transcode', 'thumbnail', 'ai_detect_events', 'ai_auto_clip', 'face_blur'])
export const reactionType = pgEnum("reaction_type", ['like', 'fire', 'clap'])
export const reconciliationDiffKind = pgEnum("reconciliation_diff_kind", ['missing_at_provider', 'missing_locally', 'amount_mismatch', 'status_mismatch'])
export const reconciliationRunStatus = pgEnum("reconciliation_run_status", ['running', 'completed', 'failed'])
export const refundAutoStatus = pgEnum("refund_auto_status", ['queued', 'submitted', 'manual'])
export const refundDestination = pgEnum("refund_destination", ['original_method', 'wallet'])
export const refundStatus = pgEnum("refund_status", ['pending', 'succeeded', 'failed'])
export const skillLevel = pgEnum("skill_level", ['beginner', 'intermediate', 'advanced', 'pro'])
export const surfaceType = pgEnum("surface_type", ['artificial_turf', 'natural_grass', 'indoor_hard', 'indoor_parquet', 'sand', 'asphalt'])
export const teamMemberRole = pgEnum("team_member_role", ['captain', 'vice_captain', 'player'])
export const teamMemberStatus = pgEnum("team_member_status", ['invited', 'active', 'left', 'removed'])
export const userRole = pgEnum("user_role", ['player', 'host', 'admin', 'super_admin', 'venue_partner'])
export const userStatus = pgEnum("user_status", ['active', 'suspended', 'deleted'])
export const waitlistStatus = pgEnum("waitlist_status", ['waiting', 'notified', 'converted', 'expired', 'cancelled'])
export const waiverSignMethod = pgEnum("waiver_sign_method", ['clickwrap', 'otp_confirmed', 'drawn'])
export const walletTxnType = pgEnum("wallet_txn_type", ['refund_credit', 'booking_debit', 'promo_credit', 'adjustment', 'expiry'])

export const amenities = pgTable("amenities", {
	id: smallint().primaryKey().generatedAlwaysAsIdentity({ name: "amenities_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 32767, cache: 1 }),
	code: text().notNull(),
	name: jsonb().notNull(),
	icon: text(),
}, (table) => [
	unique("amenities_code_key").on(table.code),
]);

export const auditLogs = pgTable("audit_logs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "audit_logs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	actorUserId: uuid("actor_user_id"),
	actorRole: userRole("actor_role"),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id"),
	changes: jsonb().default({}).notNull(),
	ip: inet(),
	requestId: text("request_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_logs_actor_idx").using("btree", table.actorUserId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_entity_idx").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_fkey"
		}),
]);

export const authIdentities = pgTable("auth_identities", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	provider: authProvider().notNull(),
	providerUid: text("provider_uid").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	displayLabel: text("display_label"),
}, (table) => [
	index("auth_identities_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("auth_identities_user_provider_key").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.provider.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "auth_identities_user_id_fkey"
		}),
	unique("auth_identities_provider_provider_uid_key").on(table.provider, table.providerUid),
]);

export const bookings = pgTable("bookings", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	bookableType: bookingTarget("bookable_type").default('match_slot').notNull(),
	matchId: uuid("match_id"),
	seats: smallint().default(1).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	unitPriceAmount: bigint("unit_price_amount", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	discountAmount: bigint("discount_amount", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	walletAppliedAmount: bigint("wallet_applied_amount", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	status: bookingStatus().default('pending_payment').notNull(),
	waiverSignatureId: uuid("waiver_signature_id"),
	idempotencyKey: text("idempotency_key").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancelledBy: uuid("cancelled_by"),
	cancelReason: text("cancel_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	competitionEntryId: uuid("competition_entry_id"),
}, (table) => [
	index("bookings_competition_entry_idx").using("btree", table.competitionEntryId.asc().nullsLast().op("uuid_ops")).where(sql`(competition_entry_id IS NOT NULL)`),
	index("bookings_expiry_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'pending_payment'::booking_status)`),
	index("bookings_match_idx").using("btree", table.matchId.asc().nullsLast().op("uuid_ops")),
	index("bookings_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.cancelledBy],
			foreignColumns: [users.id],
			name: "bookings_cancelled_by_fkey"
		}),
	foreignKey({
			columns: [table.competitionEntryId],
			foreignColumns: [competitionEntries.id],
			name: "bookings_competition_entry_id_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "bookings_currency_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "bookings_match_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "bookings_user_id_fkey"
		}),
	foreignKey({
			columns: [table.waiverSignatureId],
			foreignColumns: [waiverSignatures.id],
			name: "bookings_waiver_signature_id_fkey"
		}),
	unique("bookings_user_id_idempotency_key_key").on(table.idempotencyKey, table.userId),
	check("bookings_amount_math", sql`total_amount = (((unit_price_amount * seats) - discount_amount) - wallet_applied_amount)`),
	check("bookings_discount_amount_check", sql`discount_amount >= 0`),
	check("bookings_hold_has_expiry", sql`(status <> 'pending_payment'::booking_status) OR (expires_at IS NOT NULL)`),
	check("bookings_seats_check", sql`(seats >= 1) AND (seats <= 4)`),
	check("bookings_target_arc", sql`((bookable_type = 'match_slot'::booking_target) AND (match_id IS NOT NULL) AND (competition_entry_id IS NULL)) OR ((bookable_type = 'competition_entry'::booking_target) AND (competition_entry_id IS NOT NULL) AND (match_id IS NULL))`),
	check("bookings_total_amount_check", sql`total_amount >= 0`),
	check("bookings_unit_price_amount_check", sql`unit_price_amount >= 0`),
	check("bookings_waiver_required", sql`(bookable_type <> 'match_slot'::booking_target) OR (waiver_signature_id IS NOT NULL)`),
	check("bookings_wallet_applied_amount_check", sql`wallet_applied_amount >= 0`),
]);

export const cancellationPolicies = pgTable("cancellation_policies", {
	id: smallint().primaryKey().generatedAlwaysAsIdentity({ name: "cancellation_policies_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 32767, cache: 1 }),
	code: text().notNull(),
	name: jsonb().notNull(),
	rules: jsonb().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
}, (table) => [
	uniqueIndex("cancellation_policies_one_default").using("btree", table.isDefault.asc().nullsLast().op("bool_ops")).where(sql`is_default`),
	unique("cancellation_policies_code_key").on(table.code),
	check("cancellation_policies_rules_check", sql`jsonb_typeof(rules) = 'array'::text`),
]);

export const checkinEvents = pgTable("checkin_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	participantId: uuid("participant_id").notNull(),
	hostAssignmentId: uuid("host_assignment_id"),
	actorUserId: uuid("actor_user_id").notNull(),
	action: checkinAction().notNull(),
	method: checkinMethod().notNull(),
	clientEventId: uuid("client_event_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deviceLocation: geography("device_location"),
	deviceId: text("device_id"),
}, (table) => [
	index("checkin_events_match_idx").using("btree", table.matchId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "checkin_events_actor_user_id_fkey"
		}),
	foreignKey({
			columns: [table.hostAssignmentId],
			foreignColumns: [hostAssignments.id],
			name: "checkin_events_host_assignment_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "checkin_events_match_id_fkey"
		}),
	foreignKey({
			columns: [table.participantId],
			foreignColumns: [matchParticipants.id],
			name: "checkin_events_participant_id_fkey"
		}),
	unique("checkin_events_client_event_id_key").on(table.clientEventId),
]);

export const cities = pgTable("cities", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "cities_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	countryCode: char("country_code", { length: 2 }).notNull(),
	slug: text().notNull(),
	name: jsonb().notNull(),
	timezone: text().notNull(),
	center: geography("center").notNull(),
	defaultCurrency: char("default_currency", { length: 3 }).notNull(),
	isActive: boolean("is_active").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.countryCode],
			foreignColumns: [countries.code],
			name: "cities_country_code_fkey"
		}),
	foreignKey({
			columns: [table.defaultCurrency],
			foreignColumns: [currencies.code],
			name: "cities_default_currency_fkey"
		}),
	unique("cities_slug_key").on(table.slug),
]);

export const competitionEntries = pgTable("competition_entries", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	competitionId: uuid("competition_id").notNull(),
	teamId: uuid("team_id").notNull(),
	status: entryStatus().default('pending_payment').notNull(),
	seed: smallint(),
	groupLabel: text("group_label"),
	registeredBy: uuid("registered_by").notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.competitionId],
			foreignColumns: [competitions.id],
			name: "competition_entries_competition_id_fkey"
		}),
	foreignKey({
			columns: [table.registeredBy],
			foreignColumns: [users.id],
			name: "competition_entries_registered_by_fkey"
		}),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "competition_entries_team_id_fkey"
		}),
	unique("competition_entries_competition_id_team_id_key").on(table.competitionId, table.teamId),
]);

export const competitions = pgTable("competitions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	type: competitionType().notNull(),
	sportId: smallint("sport_id").notNull(),
	cityId: integer("city_id").notNull(),
	name: jsonb().notNull(),
	slug: text().notNull(),
	season: text(),
	format: jsonb().default({}).notNull(),
	teamSizeMin: smallint("team_size_min").notNull(),
	teamSizeMax: smallint("team_size_max").notNull(),
	maxTeams: smallint("max_teams"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entryFeeAmount: bigint("entry_fee_amount", { mode: "number" }).default(0).notNull(),
	entryFeeMode: entryFeeMode("entry_fee_mode").default('per_team').notNull(),
	currency: char({ length: 3 }).notNull(),
	registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true, mode: 'string' }),
	registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true, mode: 'string' }),
	startsOn: date("starts_on"),
	endsOn: date("ends_on"),
	status: competitionStatus().default('draft').notNull(),
	waiverTemplateCode: text("waiver_template_code").default('general_liability').notNull(),
	cancellationPolicyId: smallint("cancellation_policy_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("competitions_city_status_idx").using("btree", table.cityId.asc().nullsLast().op("int4_ops"), table.status.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.cancellationPolicyId],
			foreignColumns: [cancellationPolicies.id],
			name: "competitions_cancellation_policy_id_fkey"
		}),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "competitions_city_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "competitions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "competitions_currency_fkey"
		}),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "competitions_sport_id_fkey"
		}),
	unique("competitions_slug_key").on(table.slug),
	check("competitions_check", sql`(team_size_min > 0) AND (team_size_min <= team_size_max)`),
	check("competitions_check1", sql`(ends_on IS NULL) OR (starts_on IS NULL) OR (ends_on >= starts_on)`),
	check("competitions_entry_fee_amount_check", sql`entry_fee_amount >= 0`),
]);

export const consents = pgTable("consents", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	purpose: consentPurpose().notNull(),
	granted: boolean().notNull(),
	documentVersion: text("document_version"),
	source: text().notNull(),
	ip: inet(),
	userAgent: text("user_agent"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("consents_user_purpose_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.purpose.asc().nullsLast().op("timestamptz_ops"), table.recordedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "consents_user_id_fkey"
		}),
]);

export const countries = pgTable("countries", {
	code: char({ length: 2 }).primaryKey().notNull(),
	name: jsonb().notNull(),
	defaultCurrency: char("default_currency", { length: 3 }).notNull(),
	defaultLocale: text("default_locale").notNull(),
	phonePrefix: text("phone_prefix").notNull(),
	dataRegion: text("data_region").notNull(),
	isActive: boolean("is_active").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.defaultCurrency],
			foreignColumns: [currencies.code],
			name: "countries_default_currency_fkey"
		}),
	check("countries_code_check", sql`code ~ '^[A-Z]{2}$'::text`),
]);

export const currencies = pgTable("currencies", {
	code: char({ length: 3 }).primaryKey().notNull(),
	minorUnit: smallint("minor_unit").notNull(),
	symbol: text().notNull(),
	name: jsonb().default({}).notNull(),
}, (table) => [
	check("currencies_code_check", sql`code ~ '^[A-Z]{3}$'::text`),
	check("currencies_minor_unit_check", sql`(minor_unit >= 0) AND (minor_unit <= 4)`),
]);

export const dataSubjectRequests = pgTable("data_subject_requests", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: dsrType().notNull(),
	status: dsrStatus().default('received').notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '30 days'::interval)`).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	exportMediaId: uuid("export_media_id"),
	handledBy: uuid("handled_by"),
	notes: text(),
	exportPath: text("export_path"),
	exportSha256: bytea("export_sha256"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	exportSizeBytes: bigint("export_size_bytes", { mode: "number" }),
	exportExpiresAt: timestamp("export_expires_at", { withTimezone: true, mode: 'string' }),
	blockedReasons: jsonb("blocked_reasons"),
	blockedAt: timestamp("blocked_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("dsr_export_expiry_idx").using("btree", table.exportExpiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(export_path IS NOT NULL)`),
	uniqueIndex("dsr_one_open_erasure").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`((type = 'erasure'::dsr_type) AND (status = ANY (ARRAY['received'::dsr_status, 'in_progress'::dsr_status])))`),
	index("dsr_open_idx").using("btree", table.dueAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['received'::dsr_status, 'in_progress'::dsr_status]))`),
	index("dsr_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.handledBy],
			foreignColumns: [users.id],
			name: "data_subject_requests_handled_by_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "data_subject_requests_user_id_fkey"
		}),
	foreignKey({
			columns: [table.exportMediaId],
			foreignColumns: [mediaAssets.id],
			name: "dsr_export_fk"
		}),
	check("data_subject_requests_export_size_bytes_check", sql`export_size_bytes >= 0`),
]);

export const deviceTokens = pgTable("device_tokens", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	platform: devicePlatform().notNull(),
	pushToken: text("push_token").notNull(),
	locale: text().notNull(),
	appVersion: text("app_version"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	disabledAt: timestamp("disabled_at", { withTimezone: true, mode: 'string' }),
	provider: text().default('expo').notNull(),
	disabledReason: text("disabled_reason"),
}, (table) => [
	index("device_tokens_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(disabled_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "device_tokens_user_id_fkey"
		}),
	unique("device_tokens_push_token_key").on(table.pushToken),
	check("device_tokens_provider_check", sql`provider = ANY (ARRAY['expo'::text, 'fcm'::text, 'apns'::text])`),
]);

export const fieldLeases = pgTable("field_leases", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	pitchId: uuid("pitch_id").notNull(),
	period: tstzrange("period").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	costAmount: bigint("cost_amount", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	status: leaseStatus().default('reserved').notNull(),
	ownerInvoiceRef: text("owner_invoice_ref"),
	paidToOwnerAt: timestamp("paid_to_owner_at", { withTimezone: true, mode: 'string' }),
	notes: text(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "field_leases_created_by_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "field_leases_currency_fkey"
		}),
	foreignKey({
			columns: [table.pitchId],
			foreignColumns: [pitches.id],
			name: "field_leases_pitch_id_fkey"
		}),
	check("field_leases_cost_amount_check", sql`cost_amount >= 0`),
	check("field_leases_period_valid", sql`(NOT isempty(period)) AND lower_inc(period) AND (NOT upper_inc(period))`),
]);

export const fxRates = pgTable("fx_rates", {
	baseCurrency: char("base_currency", { length: 3 }).notNull(),
	quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
	asOf: date("as_of").notNull(),
	rate: numeric({ precision: 20, scale:  10 }).notNull(),
	source: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.baseCurrency],
			foreignColumns: [currencies.code],
			name: "fx_rates_base_currency_fkey"
		}),
	foreignKey({
			columns: [table.quoteCurrency],
			foreignColumns: [currencies.code],
			name: "fx_rates_quote_currency_fkey"
		}),
	primaryKey({ columns: [table.asOf, table.baseCurrency, table.quoteCurrency], name: "fx_rates_pkey"}),
	check("fx_rates_rate_check", sql`rate > (0)::numeric`),
]);

export const highlightReactions = pgTable("highlight_reactions", {
	highlightId: uuid("highlight_id").notNull(),
	userId: uuid("user_id").notNull(),
	type: reactionType().default('like').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.highlightId],
			foreignColumns: [highlights.id],
			name: "highlight_reactions_highlight_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "highlight_reactions_user_id_fkey"
		}),
	primaryKey({ columns: [table.highlightId, table.type, table.userId], name: "highlight_reactions_pkey"}),
]);

export const highlightShares = pgTable("highlight_shares", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	highlightId: uuid("highlight_id").notNull(),
	userId: uuid("user_id"),
	channel: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("highlight_shares_highlight_idx").using("btree", table.highlightId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.highlightId],
			foreignColumns: [highlights.id],
			name: "highlight_shares_highlight_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "highlight_shares_user_id_fkey"
		}),
]);

export const highlightTags = pgTable("highlight_tags", {
	highlightId: uuid("highlight_id").notNull(),
	userId: uuid("user_id").notNull(),
	taggedBy: uuid("tagged_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("highlight_tags_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.highlightId],
			foreignColumns: [highlights.id],
			name: "highlight_tags_highlight_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.taggedBy],
			foreignColumns: [users.id],
			name: "highlight_tags_tagged_by_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "highlight_tags_user_id_fkey"
		}),
	primaryKey({ columns: [table.highlightId, table.userId], name: "highlight_tags_pkey"}),
]);

export const highlights = pgTable("highlights", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	mediaAssetId: uuid("media_asset_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	source: highlightSource().notNull(),
	title: text(),
	clipStartedAt: timestamp("clip_started_at", { withTimezone: true, mode: 'string' }),
	matchOffsetMs: integer("match_offset_ms"),
	durationMs: integer("duration_ms"),
	visibility: highlightVisibility().default('participants').notNull(),
	moderationStatus: moderationStatus("moderation_status").default('pending').notNull(),
	likesCount: integer("likes_count").default(0).notNull(),
	sharesCount: integer("shares_count").default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	viewsCount: bigint("views_count", { mode: "number" }).default(0).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	recordingSessionId: uuid("recording_session_id"),
	moderatedBy: uuid("moderated_by"),
	moderatedAt: timestamp("moderated_at", { withTimezone: true, mode: 'string' }),
	moderationReason: text("moderation_reason"),
	moderationNote: text("moderation_note"),
}, (table) => [
	index("highlights_feed_idx").using("btree", table.publishedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`((visibility = 'public'::highlight_visibility) AND (moderation_status = 'approved'::moderation_status) AND (deleted_at IS NULL))`),
	index("highlights_match_feed_idx").using("btree", table.matchId.asc().nullsLast().op("uuid_ops"), table.publishedAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")).where(sql`((published_at IS NOT NULL) AND (deleted_at IS NULL))`),
	index("highlights_match_idx").using("btree", table.matchId.asc().nullsLast().op("uuid_ops")),
	index("highlights_moderation_idx").using("btree", table.moderationStatus.asc().nullsLast().op("timestamptz_ops"), table.publishedAt.asc().nullsLast().op("enum_ops")).where(sql`((published_at IS NOT NULL) AND (deleted_at IS NULL))`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "highlights_created_by_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "highlights_match_id_fkey"
		}),
	foreignKey({
			columns: [table.mediaAssetId],
			foreignColumns: [mediaAssets.id],
			name: "highlights_media_asset_id_fkey"
		}),
	foreignKey({
			columns: [table.moderatedBy],
			foreignColumns: [users.id],
			name: "highlights_moderated_by_fkey"
		}),
	foreignKey({
			columns: [table.recordingSessionId],
			foreignColumns: [recordingSessions.id],
			name: "highlights_recording_session_id_fkey"
		}),
	unique("highlights_media_asset_id_key").on(table.mediaAssetId),
	check("highlights_duration_ms_check", sql`duration_ms > 0`),
	check("highlights_match_offset_ms_check", sql`match_offset_ms >= 0`),
]);

export const hostAssignments = pgTable("host_assignments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	hostUserId: uuid("host_user_id").notNull(),
	status: hostAssignmentStatus().default('offered').notNull(),
	dispatchRound: smallint("dispatch_round").default(1).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	feeAmount: bigint("fee_amount", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	offeredAt: timestamp("offered_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }),
	declineReason: text("decline_reason"),
	arrivedAt: timestamp("arrived_at", { withTimezone: true, mode: 'string' }),
	arrivalLocation: geography("arrival_location"),
	arrivalDistanceM: integer("arrival_distance_m"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	payoutId: uuid("payout_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	noShowAlertedAt: timestamp("no_show_alerted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("host_assignments_host_idx").using("btree", table.hostUserId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("host_assignments_offers_idx").using("btree", table.offerExpiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'offered'::host_assignment_status)`),
	uniqueIndex("host_assignments_one_active_per_match").using("btree", table.matchId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['accepted'::host_assignment_status, 'arrived'::host_assignment_status, 'completed'::host_assignment_status]))`),
	index("host_assignments_unpaid_idx").using("btree", table.hostUserId.asc().nullsLast().op("timestamptz_ops"), table.completedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'completed'::host_assignment_status) AND (payout_id IS NULL))`),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "host_assignments_currency_fkey"
		}),
	foreignKey({
			columns: [table.hostUserId],
			foreignColumns: [hostProfiles.userId],
			name: "host_assignments_host_user_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "host_assignments_match_id_fkey"
		}),
	foreignKey({
			columns: [table.payoutId],
			foreignColumns: [hostPayouts.id],
			name: "host_assignments_payout_id_fkey"
		}),
	unique("host_assignments_match_id_host_user_id_key").on(table.hostUserId, table.matchId),
	check("host_assignments_fee_amount_check", sql`fee_amount >= 0`),
]);

export const hostPayouts = pgTable("host_payouts", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	hostUserId: uuid("host_user_id").notNull(),
	periodStart: date("period_start").notNull(),
	periodEnd: date("period_end").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	status: payoutStatus().default('pending').notNull(),
	assignmentsCount: integer("assignments_count").notNull(),
	providerRef: text("provider_ref"),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paidBy: uuid("paid_by"),
	note: text(),
}, (table) => [
	index("host_payouts_status_period_idx").using("btree", table.status.asc().nullsLast().op("date_ops"), table.periodStart.desc().nullsFirst().op("date_ops")),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "host_payouts_currency_fkey"
		}),
	foreignKey({
			columns: [table.hostUserId],
			foreignColumns: [hostProfiles.userId],
			name: "host_payouts_host_user_id_fkey"
		}),
	foreignKey({
			columns: [table.paidBy],
			foreignColumns: [users.id],
			name: "host_payouts_paid_by_fkey"
		}),
	unique("host_payouts_host_user_id_period_start_period_end_key").on(table.hostUserId, table.periodEnd, table.periodStart),
	check("host_payouts_amount_check", sql`amount >= 0`),
	check("host_payouts_check", sql`period_end >= period_start`),
	check("host_payouts_paid_complete", sql`(status <> 'paid'::payout_status) OR ((provider_ref IS NOT NULL) AND (paid_at IS NOT NULL) AND (paid_by IS NOT NULL))`),
]);

export const hostProfiles = pgTable("host_profiles", {
	userId: uuid("user_id").primaryKey().notNull(),
	status: hostStatus().default('applicant').notNull(),
	homeCityId: integer("home_city_id").notNull(),
	baseLocation: geography("base_location"),
	maxTravelKm: smallint("max_travel_km").default(10).notNull(),
	hasKit: boolean("has_kit").default(false).notNull(),
	kitNotes: text("kit_notes"),
	ratingAvg: numeric("rating_avg", { precision: 3, scale:  2 }),
	ratingCount: integer("rating_count").default(0).notNull(),
	completedMatches: integer("completed_matches").default(0).notNull(),
	noShowCount: integer("no_show_count").default(0).notNull(),
	payoutMethod: text("payout_method"),
	payoutDetailsRef: text("payout_details_ref"),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	verifiedBy: uuid("verified_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	suspendedAt: timestamp("suspended_at", { withTimezone: true, mode: 'string' }),
	suspendedReason: text("suspended_reason"),
}, (table) => [
	index("host_profiles_location_gix").using("gist", table.baseLocation.asc().nullsLast().op("gist_geography_ops")).where(sql`(status = 'active'::host_status)`),
	foreignKey({
			columns: [table.homeCityId],
			foreignColumns: [cities.id],
			name: "host_profiles_home_city_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "host_profiles_user_id_fkey"
		}),
	foreignKey({
			columns: [table.verifiedBy],
			foreignColumns: [users.id],
			name: "host_profiles_verified_by_fkey"
		}),
	check("host_profiles_suspension_consistent", sql`(status <> 'suspended'::host_status) OR (suspended_at IS NOT NULL)`),
]);

export const hostSports = pgTable("host_sports", {
	userId: uuid("user_id").notNull(),
	sportId: smallint("sport_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "host_sports_sport_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [hostProfiles.userId],
			name: "host_sports_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.sportId, table.userId], name: "host_sports_pkey"}),
]);

export const matchEvents = pgTable("match_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	sideNo: smallint("side_no"),
	participantId: uuid("participant_id"),
	type: matchEventType().notNull(),
	source: matchEventSource().default('host').notNull(),
	matchOffsetMs: integer("match_offset_ms").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }),
	confidence: numeric({ precision: 4, scale:  3 }),
	highlightId: uuid("highlight_id"),
	recordedBy: uuid("recorded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("match_events_match_idx").using("btree", table.matchId.asc().nullsLast().op("int4_ops"), table.matchOffsetMs.asc().nullsLast().op("int4_ops")),
	index("match_events_participant_idx").using("btree", table.participantId.asc().nullsLast().op("uuid_ops")).where(sql`(participant_id IS NOT NULL)`),
	foreignKey({
			columns: [table.highlightId],
			foreignColumns: [highlights.id],
			name: "match_events_highlight_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "match_events_match_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId, table.sideNo],
			foreignColumns: [matchSides.matchId, matchSides.sideNo],
			name: "match_events_match_id_side_no_fkey"
		}),
	foreignKey({
			columns: [table.participantId],
			foreignColumns: [matchParticipants.id],
			name: "match_events_participant_id_fkey"
		}),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [users.id],
			name: "match_events_recorded_by_fkey"
		}),
	check("match_events_confidence_check", sql`(confidence >= (0)::numeric) AND (confidence <= (1)::numeric)`),
	check("match_events_match_offset_ms_check", sql`match_offset_ms >= 0`),
]);

export const matchFeedback = pgTable("match_feedback", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	fromUserId: uuid("from_user_id").notNull(),
	target: feedbackTarget().notNull(),
	toUserId: uuid("to_user_id"),
	rating: smallint().notNull(),
	tags: text().array().default([""]).notNull(),
	comment: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("match_feedback_to_user_idx").using("btree", table.toUserId.asc().nullsLast().op("uuid_ops"), table.target.asc().nullsLast().op("enum_ops")).where(sql`(to_user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.fromUserId],
			foreignColumns: [users.id],
			name: "match_feedback_from_user_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "match_feedback_match_id_fkey"
		}),
	foreignKey({
			columns: [table.toUserId],
			foreignColumns: [users.id],
			name: "match_feedback_to_user_id_fkey"
		}),
	unique("match_feedback_unique").on(table.fromUserId, table.matchId, table.target, table.toUserId),
	check("match_feedback_rating_check", sql`(rating >= 1) AND (rating <= 5)`),
	check("match_feedback_target_user", sql`(target = ANY (ARRAY['host'::feedback_target, 'player'::feedback_target])) = (to_user_id IS NOT NULL)`),
]);

export const matchParticipants = pgTable("match_participants", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	bookingId: uuid("booking_id"),
	userId: uuid("user_id"),
	guestName: text("guest_name"),
	sideNo: smallint("side_no"),
	status: participantStatus().default('held').notNull(),
	source: participantSource().default('booking').notNull(),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }),
	checkedInBy: uuid("checked_in_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	bibNumber: smallint("bib_number"),
}, (table) => [
	uniqueIndex("match_participants_bib_unique").using("btree", table.matchId.asc().nullsLast().op("uuid_ops"), table.bibNumber.asc().nullsLast().op("uuid_ops")).where(sql`((bib_number IS NOT NULL) AND (status = ANY (ARRAY['held'::participant_status, 'confirmed'::participant_status, 'checked_in'::participant_status, 'no_show'::participant_status])))`),
	index("match_participants_booking_idx").using("btree", table.bookingId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("match_participants_one_active_per_user").using("btree", table.matchId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`((user_id IS NOT NULL) AND (status = ANY (ARRAY['held'::participant_status, 'confirmed'::participant_status, 'checked_in'::participant_status, 'no_show'::participant_status])))`),
	index("match_participants_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "match_participants_booking_id_fkey"
		}),
	foreignKey({
			columns: [table.checkedInBy],
			foreignColumns: [users.id],
			name: "match_participants_checked_in_by_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "match_participants_match_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId, table.sideNo],
			foreignColumns: [matchSides.matchId, matchSides.sideNo],
			name: "match_participants_match_id_side_no_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "match_participants_user_id_fkey"
		}),
	check("match_participants_bib_number_check", sql`(bib_number >= 1) AND (bib_number <= 99)`),
	check("match_participants_identity", sql`(user_id IS NOT NULL) OR (guest_name IS NOT NULL)`),
	check("match_participants_source", sql`(source <> 'booking'::participant_source) OR (booking_id IS NOT NULL)`),
]);

export const matchSides = pgTable("match_sides", {
	matchId: uuid("match_id").notNull(),
	sideNo: smallint("side_no").notNull(),
	label: text().notNull(),
	bibColor: text("bib_color"),
	score: smallint(),
	teamId: uuid("team_id"),
}, (table) => [
	index("match_sides_team_idx").using("btree", table.teamId.asc().nullsLast().op("uuid_ops")).where(sql`(team_id IS NOT NULL)`),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "match_sides_match_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "match_sides_team_id_fkey"
		}),
	primaryKey({ columns: [table.matchId, table.sideNo], name: "match_sides_pkey"}),
	check("match_sides_score_check", sql`score >= 0`),
	check("match_sides_side_no_check", sql`side_no > 0`),
]);

export const matchWaitlist = pgTable("match_waitlist", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	userId: uuid("user_id").notNull(),
	status: waitlistStatus().default('waiting').notNull(),
	notifiedAt: timestamp("notified_at", { withTimezone: true, mode: 'string' }),
	offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("match_waitlist_offer_expiry_idx").using("btree", table.offerExpiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'notified'::waitlist_status)`),
	uniqueIndex("match_waitlist_one_active").using("btree", table.matchId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['waiting'::waitlist_status, 'notified'::waitlist_status]))`),
	index("match_waitlist_queue_idx").using("btree", table.matchId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'waiting'::waitlist_status)`),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "match_waitlist_match_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "match_waitlist_user_id_fkey"
		}),
]);

export const matches = pgTable("matches", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	publicCode: text("public_code").notNull(),
	sportId: smallint("sport_id").notNull(),
	pitchId: uuid("pitch_id").notNull(),
	leaseId: uuid("lease_id"),
	cityId: integer("city_id").notNull(),
	location: geography("location").notNull(),
	title: jsonb().default({}).notNull(),
	description: jsonb().default({}).notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	format: text().notNull(),
	sidesCount: smallint("sides_count").default(2).notNull(),
	playersPerSide: smallint("players_per_side").notNull(),
	minPlayers: smallint("min_players").notNull(),
	maxPlayers: smallint("max_players").notNull(),
	heldSlots: smallint("held_slots").default(0).notNull(),
	confirmedSlots: smallint("confirmed_slots").default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	priceAmount: bigint("price_amount", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	skillMin: skillLevel("skill_min"),
	skillMax: skillLevel("skill_max"),
	genderPolicy: matchGenderPolicy("gender_policy").default('any').notNull(),
	minAge: smallint("min_age").default(16).notNull(),
	visibility: matchVisibility().default('public').notNull(),
	status: matchStatus().default('draft').notNull(),
	waiverTemplateCode: text("waiver_template_code").default('general_liability').notNull(),
	cancellationPolicyId: smallint("cancellation_policy_id").notNull(),
	bookingClosesAt: timestamp("booking_closes_at", { withTimezone: true, mode: 'string' }).notNull(),
	minPlayersDeadline: timestamp("min_players_deadline", { withTimezone: true, mode: 'string' }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	hostFeeAmount: bigint("host_fee_amount", { mode: "number" }).default(0).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancelReason: text("cancel_reason"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by").notNull(),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	competitionId: uuid("competition_id"),
	roundLabel: text("round_label"),
}, (table) => [
	index("matches_city_time_idx").using("btree", table.cityId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("int4_ops")).where(sql`((status = ANY (ARRAY['open'::match_status, 'full'::match_status])) AND (visibility = 'public'::match_visibility))`),
	index("matches_competition_idx").using("btree", table.competitionId.asc().nullsLast().op("uuid_ops")).where(sql`(competition_id IS NOT NULL)`),
	index("matches_deadline_idx").using("btree", table.minPlayersDeadline.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'open'::match_status)`),
	index("matches_discovery_gix").using("gist", table.location.asc().nullsLast().op("gist_timestamptz_ops"), table.startsAt.asc().nullsLast().op("gist_timestamptz_ops")).where(sql`((status = ANY (ARRAY['open'::match_status, 'full'::match_status])) AND (visibility = 'public'::match_visibility))`),
	index("matches_lease_idx").using("btree", table.leaseId.asc().nullsLast().op("uuid_ops")),
	index("matches_pitch_idx").using("btree", table.pitchId.asc().nullsLast().op("uuid_ops")),
	index("matches_sport_time_idx").using("btree", table.sportId.asc().nullsLast().op("int2_ops"), table.startsAt.asc().nullsLast().op("int2_ops")),
	index("matches_starts_at_idx").using("btree", table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cancellationPolicyId],
			foreignColumns: [cancellationPolicies.id],
			name: "matches_cancellation_policy_id_fkey"
		}),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "matches_city_id_fkey"
		}),
	foreignKey({
			columns: [table.competitionId],
			foreignColumns: [competitions.id],
			name: "matches_competition_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "matches_created_by_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "matches_currency_fkey"
		}),
	foreignKey({
			columns: [table.leaseId],
			foreignColumns: [fieldLeases.id],
			name: "matches_lease_id_fkey"
		}),
	foreignKey({
			columns: [table.pitchId],
			foreignColumns: [pitches.id],
			name: "matches_pitch_id_fkey"
		}),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "matches_sport_id_fkey"
		}),
	unique("matches_public_code_key").on(table.publicCode),
	check("matches_cancel_consistent", sql`(status <> 'cancelled'::match_status) OR (cancelled_at IS NOT NULL)`),
	check("matches_capacity", sql`(held_slots >= 0) AND (confirmed_slots >= 0) AND ((held_slots + confirmed_slots) <= max_players)`),
	check("matches_deadlines_valid", sql`(booking_closes_at <= starts_at) AND (min_players_deadline <= starts_at)`),
	check("matches_host_fee_amount_check", sql`host_fee_amount >= 0`),
	check("matches_players_per_side_check", sql`players_per_side > 0`),
	check("matches_players_valid", sql`(min_players > 0) AND (min_players <= max_players)`),
	check("matches_price_amount_check", sql`price_amount >= 0`),
	check("matches_sides_count_check", sql`sides_count >= 2`),
	check("matches_skill_range", sql`(skill_min IS NULL) OR (skill_max IS NULL) OR (skill_min <= skill_max)`),
	check("matches_time_valid", sql`ends_at > starts_at`),
]);

export const mediaAssets = pgTable("media_assets", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	ownerUserId: uuid("owner_user_id"),
	kind: mediaKind().notNull(),
	status: mediaStatus().default('uploading').notNull(),
	storageRegion: text("storage_region").notNull(),
	bucket: text().notNull(),
	objectKey: text("object_key").notNull(),
	contentType: text("content_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	durationMs: integer("duration_ms"),
	width: integer(),
	height: integer(),
	checksumSha256: bytea("checksum_sha256"),
	uploadId: text("upload_id"),
	playbackPath: text("playback_path"),
	thumbnailKey: text("thumbnail_key"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	context: jsonb(),
	uploadPartSize: integer("upload_part_size"),
	uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true, mode: 'string' }),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }),
	outputBucket: text("output_bucket"),
	renditions: jsonb(),
	verticalKey: text("vertical_key"),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	failureCode: text("failure_code"),
}, (table) => [
	index("media_assets_owner_idx").using("btree", table.ownerUserId.asc().nullsLast().op("uuid_ops")),
	index("media_assets_upload_expiry_idx").using("btree", table.uploadExpiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'uploading'::media_status)`),
	foreignKey({
			columns: [table.ownerUserId],
			foreignColumns: [users.id],
			name: "media_assets_owner_user_id_fkey"
		}),
	unique("media_assets_bucket_object_key_key").on(table.bucket, table.objectKey),
	check("media_assets_duration_ms_check", sql`duration_ms >= 0`),
	check("media_assets_size_bytes_check", sql`size_bytes >= 0`),
	check("media_assets_upload_part_size_check", sql`upload_part_size > 0`),
]);

export const mediaProcessingJobs = pgTable("media_processing_jobs", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	mediaAssetId: uuid("media_asset_id").notNull(),
	type: processingJobType().notNull(),
	status: processingJobStatus().default('queued').notNull(),
	workerVersion: text("worker_version"),
	attempts: smallint().default(0).notNull(),
	input: jsonb().default({}).notNull(),
	output: jsonb(),
	error: text(),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	recordingSessionId: uuid("recording_session_id"),
	stage: text(),
	transport: text().default('redis_stream').notNull(),
	messageId: text("message_id"),
	dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: 'string' }),
	heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("media_processing_jobs_asset_idx").using("btree", table.mediaAssetId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("media_processing_jobs_one_active").using("btree", table.mediaAssetId.asc().nullsLast().op("enum_ops"), table.type.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['queued'::processing_job_status, 'running'::processing_job_status]))`),
	index("media_processing_jobs_queue_idx").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.queuedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['queued'::processing_job_status, 'running'::processing_job_status]))`),
	index("media_processing_jobs_recording_idx").using("btree", table.recordingSessionId.asc().nullsLast().op("uuid_ops")).where(sql`(recording_session_id IS NOT NULL)`),
	index("media_processing_jobs_undispatched_idx").using("btree", table.queuedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'queued'::processing_job_status) AND (dispatched_at IS NULL))`),
	foreignKey({
			columns: [table.mediaAssetId],
			foreignColumns: [mediaAssets.id],
			name: "media_processing_jobs_media_asset_id_fkey"
		}),
	foreignKey({
			columns: [table.recordingSessionId],
			foreignColumns: [recordingSessions.id],
			name: "media_processing_jobs_recording_session_id_fkey"
		}),
	check("media_processing_jobs_transport_check", sql`transport = ANY (ARRAY['redis_stream'::text, 'sqs'::text])`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: text().notNull(),
	channel: notificationChannel().notNull(),
	status: notificationStatus().default('queued').notNull(),
	locale: text().notNull(),
	payload: jsonb().notNull(),
	providerMessageId: text("provider_message_id"),
	error: text(),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dedupeKey: text("dedupe_key"),
	category: text().default('transactional').notNull(),
	attempts: smallint().default(0).notNull(),
	nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("notifications_dedupe_key_idx").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")),
	index("notifications_retry_idx").using("btree", table.nextAttemptAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'queued'::notification_status)`),
	index("notifications_unread_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(read_at IS NULL)`),
	index("notifications_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_fkey"
		}),
	check("notifications_category_check", sql`category = ANY (ARRAY['transactional'::text, 'marketing'::text])`),
]);

export const outboxEvents = pgTable("outbox_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	aggregateType: text("aggregate_type").notNull(),
	aggregateId: uuid("aggregate_id").notNull(),
	eventType: text("event_type").notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	attempts: integer().default(0).notNull(),
	lastError: text("last_error"),
}, (table) => [
	index("outbox_unpublished_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(published_at IS NULL)`),
]);

export const paymentEvents = pgTable("payment_events", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	provider: paymentProvider().notNull(),
	providerEventId: text("provider_event_id").notNull(),
	eventType: text("event_type").notNull(),
	paymentId: uuid("payment_id"),
	payload: jsonb().notNull(),
	signatureValid: boolean("signature_valid").notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	processingError: text("processing_error"),
}, (table) => [
	index("payment_events_unprocessed_idx").using("btree", table.receivedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(processed_at IS NULL)`),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payments.id],
			name: "payment_events_payment_id_fkey"
		}),
	unique("payment_events_provider_provider_event_id_key").on(table.provider, table.providerEventId),
]);

export const paymentProviderConfigs = pgTable("payment_provider_configs", {
	id: smallint().primaryKey().generatedAlwaysAsIdentity({ name: "payment_provider_configs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 32767, cache: 1 }),
	countryCode: char("country_code", { length: 2 }).notNull(),
	provider: paymentProvider().notNull(),
	currencies: char({ length: 3 }).array().notNull(),
	priority: smallint().default(100).notNull(),
	isEnabled: boolean("is_enabled").default(false).notNull(),
	merchantId: text("merchant_id"),
	secretRef: text("secret_ref").notNull(),
	settings: jsonb().default({}).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.countryCode],
			foreignColumns: [countries.code],
			name: "payment_provider_configs_country_code_fkey"
		}),
	unique("payment_provider_configs_country_code_provider_key").on(table.countryCode, table.provider),
]);

export const payments = pgTable("payments", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	bookingId: uuid("booking_id").notNull(),
	userId: uuid("user_id").notNull(),
	provider: paymentProvider().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	status: paymentStatus().default('created').notNull(),
	providerTransactionId: text("provider_transaction_id"),
	providerState: jsonb("provider_state").default({}).notNull(),
	checkoutUrl: text("checkout_url"),
	failureCode: text("failure_code"),
	failureMessage: text("failure_message"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	refundedAmount: bigint("refunded_amount", { mode: "number" }).default(0).notNull(),
	authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: 'string' }),
	succeededAt: timestamp("succeeded_at", { withTimezone: true, mode: 'string' }),
	failedAt: timestamp("failed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payments_booking_idx").using("btree", table.bookingId.asc().nullsLast().op("uuid_ops")),
	index("payments_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("payments_one_success_per_booking").using("btree", table.bookingId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['succeeded'::payment_status, 'partially_refunded'::payment_status, 'refunded'::payment_status]))`),
	index("payments_open_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['created'::payment_status, 'pending'::payment_status, 'authorized'::payment_status]))`),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "payments_booking_id_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "payments_currency_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "payments_user_id_fkey"
		}),
	unique("payments_provider_provider_transaction_id_key").on(table.provider, table.providerTransactionId),
	check("payments_amount_check", sql`amount >= 0`),
	check("payments_refund_bounds", sql`(refunded_amount >= 0) AND (refunded_amount <= amount)`),
]);

export const pitchSports = pgTable("pitch_sports", {
	pitchId: uuid("pitch_id").notNull(),
	sportId: smallint("sport_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.pitchId],
			foreignColumns: [pitches.id],
			name: "pitch_sports_pitch_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "pitch_sports_sport_id_fkey"
		}),
	primaryKey({ columns: [table.pitchId, table.sportId], name: "pitch_sports_pkey"}),
]);

export const pitches = pgTable("pitches", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	venueId: uuid("venue_id").notNull(),
	name: text().notNull(),
	surface: surfaceType().notNull(),
	isIndoor: boolean("is_indoor").default(false).notNull(),
	lengthM: numeric("length_m", { precision: 5, scale:  1 }),
	widthM: numeric("width_m", { precision: 5, scale:  1 }),
	maxPlayersPerSide: smallint("max_players_per_side"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "pitches_venue_id_fkey"
		}),
	unique("pitches_venue_id_name_key").on(table.name, table.venueId),
	check("pitches_max_players_per_side_check", sql`max_players_per_side > 0`),
]);

export const playerRatingChanges = pgTable("player_rating_changes", {
	matchId: uuid("match_id").notNull(),
	userId: uuid("user_id").notNull(),
	sportId: smallint("sport_id").notNull(),
	sideNo: smallint("side_no").notNull(),
	score: numeric({ precision: 3, scale:  2 }).notNull(),
	ratingBefore: numeric("rating_before", { precision: 7, scale:  2 }).notNull(),
	rdBefore: numeric("rd_before", { precision: 6, scale:  2 }).notNull(),
	volBefore: numeric("vol_before", { precision: 8, scale:  6 }).notNull(),
	ratingAfter: numeric("rating_after", { precision: 7, scale:  2 }).notNull(),
	rdAfter: numeric("rd_after", { precision: 6, scale:  2 }).notNull(),
	volAfter: numeric("vol_after", { precision: 8, scale:  6 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("player_rating_changes_user_idx").using("btree", table.userId.asc().nullsLast().op("int2_ops"), table.sportId.asc().nullsLast().op("int2_ops"), table.createdAt.desc().nullsFirst().op("int2_ops")),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "player_rating_changes_match_id_fkey"
		}),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "player_rating_changes_sport_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "player_rating_changes_user_id_fkey"
		}),
	primaryKey({ columns: [table.matchId, table.userId], name: "player_rating_changes_pkey"}),
	check("player_rating_changes_score_check", sql`(score >= (0)::numeric) AND (score <= (1)::numeric)`),
]);

export const playerSportProfiles = pgTable("player_sport_profiles", {
	userId: uuid("user_id").notNull(),
	sportId: smallint("sport_id").notNull(),
	selfLevel: skillLevel("self_level").default('beginner').notNull(),
	rating: numeric({ precision: 7, scale:  2 }).default('1500').notNull(),
	ratingDeviation: numeric("rating_deviation", { precision: 6, scale:  2 }).default('350').notNull(),
	gamesPlayed: integer("games_played").default(0).notNull(),
	noShowCount: integer("no_show_count").default(0).notNull(),
	preferredPosition: text("preferred_position"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ratingVolatility: numeric("rating_volatility", { precision: 8, scale:  6 }).default('0.06').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "player_sport_profiles_sport_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "player_sport_profiles_user_id_fkey"
		}),
	primaryKey({ columns: [table.sportId, table.userId], name: "player_sport_profiles_pkey"}),
	check("player_sport_profiles_games_played_check", sql`games_played >= 0`),
	check("player_sport_profiles_no_show_count_check", sql`no_show_count >= 0`),
	check("player_sport_profiles_rating_volatility_check", sql`rating_volatility > (0)::numeric`),
]);

export const pushDeliveries = pgTable("push_deliveries", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	notificationId: uuid("notification_id").notNull(),
	deviceTokenId: uuid("device_token_id").notNull(),
	provider: text().notNull(),
	ticketId: text("ticket_id"),
	status: text().notNull(),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	receiptCheckedAt: timestamp("receipt_checked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("push_deliveries_device_idx").using("btree", table.deviceTokenId.asc().nullsLast().op("uuid_ops")),
	index("push_deliveries_notification_idx").using("btree", table.notificationId.asc().nullsLast().op("uuid_ops")),
	index("push_deliveries_receipt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'sent'::text) AND (ticket_id IS NOT NULL) AND (receipt_checked_at IS NULL))`),
	foreignKey({
			columns: [table.deviceTokenId],
			foreignColumns: [deviceTokens.id],
			name: "push_deliveries_device_token_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.notificationId],
			foreignColumns: [notifications.id],
			name: "push_deliveries_notification_id_fkey"
		}),
	check("push_deliveries_status_check", sql`status = ANY (ARRAY['sent'::text, 'delivered'::text, 'failed'::text])`),
]);

export const reconciliationItems = pgTable("reconciliation_items", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	runId: uuid("run_id").notNull(),
	kind: reconciliationDiffKind().notNull(),
	paymentId: uuid("payment_id"),
	providerTransactionId: text("provider_transaction_id"),
	bookingId: uuid("booking_id"),
	currency: char({ length: 3 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	localAmount: bigint("local_amount", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	providerAmount: bigint("provider_amount", { mode: "number" }),
	localStatus: text("local_status"),
	providerStatus: text("provider_status"),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("reconciliation_items_payment_idx").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")).where(sql`(payment_id IS NOT NULL)`),
	index("reconciliation_items_run_idx").using("btree", table.runId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "reconciliation_items_currency_fkey"
		}),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payments.id],
			name: "reconciliation_items_payment_id_fkey"
		}),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [reconciliationRuns.id],
			name: "reconciliation_items_run_id_fkey"
		}),
	check("reconciliation_items_ref", sql`(payment_id IS NOT NULL) OR (provider_transaction_id IS NOT NULL)`),
]);

export const reconciliationRuns = pgTable("reconciliation_runs", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	provider: paymentProvider().notNull(),
	periodFrom: timestamp("period_from", { withTimezone: true, mode: 'string' }).notNull(),
	periodTo: timestamp("period_to", { withTimezone: true, mode: 'string' }).notNull(),
	status: reconciliationRunStatus().default('running').notNull(),
	trigger: text().notNull(),
	triggeredBy: uuid("triggered_by"),
	localCount: integer("local_count").default(0).notNull(),
	providerCount: integer("provider_count").default(0).notNull(),
	matchedCount: integer("matched_count").default(0).notNull(),
	diffCount: integer("diff_count").default(0).notNull(),
	error: text(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("reconciliation_runs_one_running").using("btree", table.provider.asc().nullsLast().op("timestamptz_ops"), table.periodFrom.asc().nullsLast().op("enum_ops"), table.periodTo.asc().nullsLast().op("enum_ops")).where(sql`(status = 'running'::reconciliation_run_status)`),
	index("reconciliation_runs_provider_idx").using("btree", table.provider.asc().nullsLast().op("enum_ops"), table.periodFrom.desc().nullsFirst().op("timestamptz_ops")),
	index("reconciliation_runs_started_idx").using("btree", table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.triggeredBy],
			foreignColumns: [users.id],
			name: "reconciliation_runs_triggered_by_fkey"
		}),
	check("reconciliation_runs_diff_count_check", sql`diff_count >= 0`),
	check("reconciliation_runs_local_count_check", sql`local_count >= 0`),
	check("reconciliation_runs_manual_actor", sql`(trigger = 'schedule'::text) OR (triggered_by IS NOT NULL)`),
	check("reconciliation_runs_matched_count_check", sql`matched_count >= 0`),
	check("reconciliation_runs_period", sql`period_from < period_to`),
	check("reconciliation_runs_provider_count_check", sql`provider_count >= 0`),
	check("reconciliation_runs_trigger_check", sql`trigger = ANY (ARRAY['schedule'::text, 'manual'::text])`),
]);

export const recordingCameras = pgTable("recording_cameras", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	clientCameraId: uuid("client_camera_id").notNull(),
	position: text().notNull(),
	recordedBy: uuid("recorded_by").notNull(),
	deviceModel: text("device_model"),
	status: text().default('recording').notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: 'string' }),
	durationMs: integer("duration_ms"),
	fps: numeric({ precision: 6, scale:  3 }),
	width: integer(),
	height: integer(),
	mediaAssetId: uuid("media_asset_id"),
	failureCode: text("failure_code"),
	syncOffsetMs: integer("sync_offset_ms"),
	calibration: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recording_cameras_session_idx").using("btree", table.sessionId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.mediaAssetId],
			foreignColumns: [mediaAssets.id],
			name: "recording_cameras_media_asset_id_fkey"
		}),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [users.id],
			name: "recording_cameras_recorded_by_fkey"
		}),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [recordingSessions.id],
			name: "recording_cameras_session_id_fkey"
		}),
	unique("recording_cameras_client_camera_id_key").on(table.clientCameraId),
	unique("recording_cameras_media_asset_id_key").on(table.mediaAssetId),
	check("recording_cameras_duration_ms_check", sql`duration_ms >= 0`),
	check("recording_cameras_fps_check", sql`fps > (0)::numeric`),
	check("recording_cameras_height_check", sql`height > 0`),
	check("recording_cameras_position_check", sql`"position" = ANY (ARRAY['left'::text, 'right'::text, 'wide'::text])`),
	check("recording_cameras_status_check", sql`status = ANY (ARRAY['recording'::text, 'recorded'::text, 'uploading'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'cancelled'::text])`),
	check("recording_cameras_stop_after_start", sql`(stopped_at IS NULL) OR (stopped_at >= started_at)`),
	check("recording_cameras_width_check", sql`width > 0`),
]);

export const recordingMarkers = pgTable("recording_markers", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	clientMarkerId: uuid("client_marker_id").notNull(),
	kind: text().notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	side: text(),
	participantId: uuid("participant_id"),
	preMs: integer("pre_ms").default(12000).notNull(),
	postMs: integer("post_ms").default(3000).notNull(),
	createdBy: uuid("created_by").notNull(),
	cameraId: uuid("camera_id"),
	highlightId: uuid("highlight_id"),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recording_markers_pending_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")).where(sql`((kind = 'highlight'::text) AND (highlight_id IS NULL) AND (deleted_at IS NULL))`),
	index("recording_markers_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cameraId],
			foreignColumns: [recordingCameras.id],
			name: "recording_markers_camera_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "recording_markers_created_by_fkey"
		}),
	foreignKey({
			columns: [table.highlightId],
			foreignColumns: [highlights.id],
			name: "recording_markers_highlight_id_fkey"
		}),
	foreignKey({
			columns: [table.participantId],
			foreignColumns: [matchParticipants.id],
			name: "recording_markers_participant_id_fkey"
		}),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [recordingSessions.id],
			name: "recording_markers_session_id_fkey"
		}),
	unique("recording_markers_client_marker_id_key").on(table.clientMarkerId),
	unique("recording_markers_highlight_id_key").on(table.highlightId),
	check("recording_markers_clip_length", sql`((pre_ms + post_ms) >= 3000) AND ((pre_ms + post_ms) <= 60000)`),
	check("recording_markers_kind_check", sql`kind = ANY (ARRAY['highlight'::text, 'kickoff'::text])`),
	check("recording_markers_post_ms_check", sql`(post_ms >= 0) AND (post_ms <= 30000)`),
	check("recording_markers_pre_ms_check", sql`(pre_ms >= 0) AND (pre_ms <= 55000)`),
	check("recording_markers_side_check", sql`side = ANY (ARRAY['left'::text, 'right'::text])`),
]);

export const recordingSessions = pgTable("recording_sessions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	matchId: uuid("match_id").notNull(),
	hostUserId: uuid("host_user_id").notNull(),
	status: text().default('recording').notNull(),
	rigType: text("rig_type").default('two_phone').notNull(),
	kickoffAt: timestamp("kickoff_at", { withTimezone: true, mode: 'string' }),
	readyAt: timestamp("ready_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.hostUserId],
			foreignColumns: [users.id],
			name: "recording_sessions_host_user_id_fkey"
		}),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "recording_sessions_match_id_fkey"
		}),
	unique("recording_sessions_match_id_key").on(table.matchId),
	check("recording_sessions_rig_type_check", sql`rig_type = ANY (ARRAY['single_phone'::text, 'two_phone'::text, 'three_phone'::text])`),
	check("recording_sessions_status_check", sql`status = ANY (ARRAY['recording'::text, 'uploading'::text, 'processing'::text, 'ready'::text, 'failed'::text])`),
]);

export const refunds = pgTable("refunds", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	paymentId: uuid("payment_id"),
	bookingId: uuid("booking_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	destination: refundDestination().notNull(),
	status: refundStatus().default('pending').notNull(),
	reason: text().notNull(),
	providerRefundId: text("provider_refund_id"),
	initiatedBy: uuid("initiated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	note: text(),
	processedBy: uuid("processed_by"),
	autoStatus: refundAutoStatus("auto_status"),
	autoAttempts: smallint("auto_attempts").default(0).notNull(),
	autoNextAt: timestamp("auto_next_at", { withTimezone: true, mode: 'string' }),
	autoSubmittedAt: timestamp("auto_submitted_at", { withTimezone: true, mode: 'string' }),
	autoError: text("auto_error"),
	manualReason: text("manual_reason"),
}, (table) => [
	index("refunds_booking_idx").using("btree", table.bookingId.asc().nullsLast().op("uuid_ops")),
	index("refunds_payment_idx").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	index("refunds_queue_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'pending'::refund_status) AND (destination = 'original_method'::refund_destination))`),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "refunds_booking_id_fkey"
		}),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "refunds_currency_fkey"
		}),
	foreignKey({
			columns: [table.initiatedBy],
			foreignColumns: [users.id],
			name: "refunds_initiated_by_fkey"
		}),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payments.id],
			name: "refunds_payment_id_fkey"
		}),
	foreignKey({
			columns: [table.processedBy],
			foreignColumns: [users.id],
			name: "refunds_processed_by_fkey"
		}),
	check("refunds_amount_check", sql`amount > 0`),
	check("refunds_auto_attempts_check", sql`auto_attempts >= 0`),
	check("refunds_manual_has_reason", sql`(NOT (auto_status IS DISTINCT FROM 'manual'::refund_auto_status)) = (manual_reason IS NOT NULL)`),
	check("refunds_manual_reason_check", sql`manual_reason = ANY (ARRAY['partial'::text, 'unsupported'::text, 'disabled'::text, 'rejected'::text, 'failed'::text, 'timeout'::text, 'legacy'::text])`),
	check("refunds_original_needs_payment", sql`(destination = 'wallet'::refund_destination) OR (payment_id IS NOT NULL)`),
]);

export const sports = pgTable("sports", {
	id: smallint().primaryKey().generatedAlwaysAsIdentity({ name: "sports_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 32767, cache: 1 }),
	code: text().notNull(),
	name: jsonb().notNull(),
	defaultPlayersPerSide: smallint("default_players_per_side").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	unique("sports_code_key").on(table.code),
	check("sports_default_players_per_side_check", sql`default_players_per_side > 0`),
]);

export const teamMembers = pgTable("team_members", {
	teamId: uuid("team_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: teamMemberRole().default('player').notNull(),
	status: teamMemberStatus().default('invited').notNull(),
	jerseyNumber: smallint("jersey_number"),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }),
	leftAt: timestamp("left_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("team_members_one_captain").using("btree", table.teamId.asc().nullsLast().op("uuid_ops")).where(sql`((role = 'captain'::team_member_role) AND (status = 'active'::team_member_status))`),
	index("team_members_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::team_member_status)`),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "team_members_team_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "team_members_user_id_fkey"
		}),
	primaryKey({ columns: [table.teamId, table.userId], name: "team_members_pkey"}),
	check("team_members_jersey_number_check", sql`(jersey_number >= 0) AND (jersey_number <= 99)`),
]);

export const teams = pgTable("teams", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	sportId: smallint("sport_id").notNull(),
	cityId: integer("city_id").notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	logoMediaId: uuid("logo_media_id"),
	captainUserId: uuid("captain_user_id").notNull(),
	skillLevel: skillLevel("skill_level"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.captainUserId],
			foreignColumns: [users.id],
			name: "teams_captain_user_id_fkey"
		}),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "teams_city_id_fkey"
		}),
	foreignKey({
			columns: [table.logoMediaId],
			foreignColumns: [mediaAssets.id],
			name: "teams_logo_media_id_fkey"
		}),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "teams_sport_id_fkey"
		}),
	unique("teams_slug_key").on(table.slug),
]);

export const userRoles = pgTable("user_roles", {
	userId: uuid("user_id").notNull(),
	role: userRole().notNull(),
	grantedBy: uuid("granted_by"),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "user_roles_granted_by_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_fkey"
		}),
	primaryKey({ columns: [table.role, table.userId], name: "user_roles_pkey"}),
]);

export const userSessions = pgTable("user_sessions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	familyId: uuid("family_id").notNull(),
	refreshTokenHash: bytea("refresh_token_hash").notNull(),
	deviceId: text("device_id"),
	platform: devicePlatform(),
	appVersion: text("app_version"),
	ip: inet(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedReason: text("revoked_reason"),
}, (table) => [
	index("user_sessions_active_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	index("user_sessions_family_idx").using("btree", table.familyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_sessions_user_id_fkey"
		}),
	unique("user_sessions_refresh_token_hash_key").on(table.refreshTokenHash),
]);

export const users = pgTable("users", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	phoneE164: text("phone_e164"),
	email: citext("email"),
	displayName: text("display_name").notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	avatarMediaId: uuid("avatar_media_id"),
	birthDate: date("birth_date"),
	gender: genderValue().default('undisclosed').notNull(),
	locale: text().default('uz-Latn').notNull(),
	countryCode: char("country_code", { length: 2 }).notNull(),
	homeCityId: integer("home_city_id"),
	dataRegion: text("data_region").notNull(),
	status: userStatus().default('active').notNull(),
	onboardedAt: timestamp("onboarded_at", { withTimezone: true, mode: 'string' }),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	anonymizedAt: timestamp("anonymized_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.countryCode],
			foreignColumns: [countries.code],
			name: "users_country_code_fkey"
		}),
	foreignKey({
			columns: [table.homeCityId],
			foreignColumns: [cities.id],
			name: "users_home_city_id_fkey"
		}),
	unique("users_email_key").on(table.email),
	unique("users_phone_e164_key").on(table.phoneE164),
	check("users_deleted_consistency", sql`(status <> 'deleted'::user_status) OR (deleted_at IS NOT NULL)`),
	check("users_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
]);

export const venueAmenities = pgTable("venue_amenities", {
	venueId: uuid("venue_id").notNull(),
	amenityId: smallint("amenity_id").notNull(),
}, (table) => [
	index("venue_amenities_amenity_idx").using("btree", table.amenityId.asc().nullsLast().op("int2_ops")),
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "venue_amenities_amenity_id_fkey"
		}),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "venue_amenities_venue_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.amenityId, table.venueId], name: "venue_amenities_pkey"}),
]);

export const venues = pgTable("venues", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	cityId: integer("city_id").notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	description: jsonb().default({}).notNull(),
	address: jsonb().default({}).notNull(),
	location: geography("location").notNull(),
	timezone: text().notNull(),
	partnerName: text("partner_name"),
	partnerPhone: text("partner_phone"),
	contractRef: text("contract_ref"),
	coverMediaId: uuid("cover_media_id"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("venues_city_idx").using("btree", table.cityId.asc().nullsLast().op("int4_ops")),
	index("venues_location_gix").using("gist", table.location.asc().nullsLast().op("gist_geography_ops")),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "venues_city_id_fkey"
		}),
	foreignKey({
			columns: [table.coverMediaId],
			foreignColumns: [mediaAssets.id],
			name: "venues_cover_fk"
		}),
	unique("venues_slug_key").on(table.slug),
]);

export const waiverSignatures = pgTable("waiver_signatures", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	templateId: uuid("template_id").notNull(),
	documentSha256: bytea("document_sha256").notNull(),
	method: waiverSignMethod().notNull(),
	typedFullName: text("typed_full_name"),
	otpChallengeRef: text("otp_challenge_ref"),
	signedAt: timestamp("signed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ip: inet(),
	userAgent: text("user_agent"),
	appVersion: text("app_version"),
	deviceId: text("device_id"),
	guardianName: text("guardian_name"),
	guardianPhone: text("guardian_phone"),
	guardianRelation: text("guardian_relation"),
	matchId: uuid("match_id"),
}, (table) => [
	index("waiver_signatures_user_tpl_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.templateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [matches.id],
			name: "waiver_signatures_match_id_fkey"
		}),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [waiverTemplates.id],
			name: "waiver_signatures_template_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "waiver_signatures_user_id_fkey"
		}),
	check("waiver_signatures_otp", sql`(method <> 'otp_confirmed'::waiver_sign_method) OR (otp_challenge_ref IS NOT NULL)`),
]);

export const waiverTemplates = pgTable("waiver_templates", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	code: text().notNull(),
	version: integer().notNull(),
	locale: text().notNull(),
	countryCode: char("country_code", { length: 2 }).notNull(),
	sportId: smallint("sport_id"),
	title: text().notNull(),
	bodyMd: text("body_md").notNull(),
	bodySha256: bytea("body_sha256").notNull(),
	minAge: smallint("min_age").default(16).notNull(),
	effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: 'string' }).notNull(),
	retiredAt: timestamp("retired_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.countryCode],
			foreignColumns: [countries.code],
			name: "waiver_templates_country_code_fkey"
		}),
	foreignKey({
			columns: [table.sportId],
			foreignColumns: [sports.id],
			name: "waiver_templates_sport_id_fkey"
		}),
	unique("waiver_templates_code_version_locale_key").on(table.code, table.locale, table.version),
	check("waiver_templates_version_check", sql`version > 0`),
]);

export const walletAccounts = pgTable("wallet_accounts", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	currency: char({ length: 3 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	balance: bigint({ mode: "number" }).default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currencies.code],
			name: "wallet_accounts_currency_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallet_accounts_user_id_fkey"
		}),
	unique("wallet_accounts_user_id_currency_key").on(table.currency, table.userId),
	check("wallet_accounts_balance_check", sql`balance >= 0`),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
	walletId: uuid("wallet_id").notNull(),
	type: walletTxnType().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
	bookingId: uuid("booking_id"),
	refundId: uuid("refund_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_transactions_wallet_idx").using("btree", table.walletId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "wallet_transactions_booking_id_fkey"
		}),
	foreignKey({
			columns: [table.refundId],
			foreignColumns: [refunds.id],
			name: "wallet_transactions_refund_id_fkey"
		}),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [walletAccounts.id],
			name: "wallet_transactions_wallet_id_fkey"
		}),
	check("wallet_transactions_amount_check", sql`amount <> 0`),
	check("wallet_transactions_balance_after_check", sql`balance_after >= 0`),
]);

export const competitionStandings = pgView("competition_standings", {	competitionId: uuid("competition_id"),
	teamId: uuid("team_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	played: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	won: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	drawn: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lost: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	goalsFor: bigint("goals_for", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	goalsAgainst: bigint("goals_against", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	goalDiff: bigint("goal_diff", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	points: bigint({ mode: "number" }),
}).as(sql`WITH results AS ( SELECT m.competition_id, ms.team_id, ms.score AS gf, opp.score AS ga FROM matches m JOIN match_sides ms ON ms.match_id = m.id JOIN match_sides opp ON opp.match_id = m.id AND opp.side_no <> ms.side_no WHERE m.competition_id IS NOT NULL AND m.status = 'completed'::match_status AND ms.team_id IS NOT NULL ) SELECT competition_id, team_id, count(*) AS played, count(*) FILTER (WHERE gf > ga) AS won, count(*) FILTER (WHERE gf = ga) AS drawn, count(*) FILTER (WHERE gf < ga) AS lost, sum(gf) AS goals_for, sum(ga) AS goals_against, sum(gf) - sum(ga) AS goal_diff, 3 * count(*) FILTER (WHERE gf > ga) + count(*) FILTER (WHERE gf = ga) AS points FROM results GROUP BY competition_id, team_id`);

export const userCurrentConsents = pgView("user_current_consents", {	userId: uuid("user_id"),
	purpose: consentPurpose(),
	granted: boolean(),
	documentVersion: text("document_version"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT DISTINCT ON (user_id, purpose) user_id, purpose, granted, document_version, recorded_at FROM consents ORDER BY user_id, purpose, recorded_at DESC`);
