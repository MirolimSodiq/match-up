-- =============================================================================
-- Match Up — 0001: Core MVP schema
-- PostgreSQL 18 + PostGIS 3.6
--
-- Konvensiyalar:
--   * PK: uuid DEFAULT uuidv7() (vaqt bo'yicha tartiblangan, B-tree uchun qulay).
--     Kichik reference jadvallar: smallint/integer identity.
--   * Pul: bigint minor units (UZS -> tiyin, Payme bilan bir xil) + char(3) currency.
--   * Vaqt: timestamptz (UTC). Ko'rsatish venue/city timezone bo'yicha.
--   * Tarjima qilinadigan kontent: jsonb {"uz-Latn": "...", "uz-Cyrl": "...", "ru": "...", "en": "..."}.
--   * Moliyaviy/audit/compliance jadvallar append-only (trigger bilan himoyalangan).
--   * Har bir modul o'z jadvallariga egalik qiladi (pastdagi bo'lim sarlavhalari = NestJS modullari).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE (uuid WITH =, tstzrange WITH &&) va (geography, timestamptz) GiST uchun
CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Helper funksiyalar
-- -----------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Append-only jadvallar uchun. GDPR anonimlashtirish job'i maxsus rol bilan
-- `SET session_replication_role = replica` orqali o'tadi (audit_logs'ga yoziladi).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- -----------------------------------------------------------------------------
-- ENUM'lar
-- -----------------------------------------------------------------------------
CREATE TYPE user_status            AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE user_role              AS ENUM ('player', 'host', 'admin', 'super_admin', 'venue_partner');
CREATE TYPE auth_provider          AS ENUM ('phone', 'google', 'apple', 'telegram');
CREATE TYPE device_platform        AS ENUM ('ios', 'android', 'web');
CREATE TYPE gender_value           AS ENUM ('male', 'female', 'other', 'undisclosed');
CREATE TYPE skill_level            AS ENUM ('beginner', 'intermediate', 'advanced', 'pro');  -- tartib muhim (<, > ishlaydi)
CREATE TYPE surface_type           AS ENUM ('artificial_turf', 'natural_grass', 'indoor_hard', 'indoor_parquet', 'sand', 'asphalt');
CREATE TYPE lease_status           AS ENUM ('reserved', 'confirmed', 'cancelled');
CREATE TYPE match_status           AS ENUM ('draft', 'open', 'full', 'in_progress', 'completed', 'cancelled');
CREATE TYPE match_visibility       AS ENUM ('public', 'unlisted', 'private');
CREATE TYPE match_gender_policy    AS ENUM ('any', 'male', 'female', 'mixed');
CREATE TYPE participant_status     AS ENUM ('held', 'confirmed', 'checked_in', 'no_show', 'cancelled', 'expired');
CREATE TYPE participant_source     AS ENUM ('booking', 'admin_invite', 'host_walk_in');
CREATE TYPE waitlist_status        AS ENUM ('waiting', 'notified', 'converted', 'expired', 'cancelled');
CREATE TYPE booking_target         AS ENUM ('match_slot');  -- Phase 2: 'competition_entry'
CREATE TYPE booking_status         AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'expired', 'completed');
CREATE TYPE payment_provider       AS ENUM ('payme', 'click', 'uzum', 'stripe', 'paypal', 'wallet', 'manual');
CREATE TYPE payment_status         AS ENUM ('created', 'pending', 'authorized', 'succeeded', 'failed',
                                            'cancelled', 'expired', 'refunded', 'partially_refunded');
CREATE TYPE refund_status          AS ENUM ('pending', 'succeeded', 'failed');
CREATE TYPE refund_destination     AS ENUM ('original_method', 'wallet');
CREATE TYPE wallet_txn_type        AS ENUM ('refund_credit', 'booking_debit', 'promo_credit', 'adjustment', 'expiry');
CREATE TYPE waiver_sign_method     AS ENUM ('clickwrap', 'otp_confirmed', 'drawn');
CREATE TYPE consent_purpose        AS ENUM ('terms_of_service', 'privacy_policy', 'marketing_sms', 'marketing_push',
                                            'marketing_email', 'analytics', 'media_appearance', 'location_tracking');
CREATE TYPE dsr_type               AS ENUM ('export', 'erasure', 'rectification', 'restriction');
CREATE TYPE dsr_status             AS ENUM ('received', 'in_progress', 'completed', 'rejected');
CREATE TYPE host_status            AS ENUM ('applicant', 'active', 'suspended', 'offboarded');
CREATE TYPE host_assignment_status AS ENUM ('offered', 'accepted', 'declined', 'expired', 'arrived',
                                            'completed', 'no_show', 'cancelled');
CREATE TYPE checkin_action         AS ENUM ('check_in', 'undo', 'no_show');
CREATE TYPE checkin_method         AS ENUM ('qr', 'manual');
CREATE TYPE payout_status          AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE feedback_target        AS ENUM ('host', 'player', 'match', 'venue');
CREATE TYPE media_kind             AS ENUM ('video', 'image');
CREATE TYPE media_status           AS ENUM ('uploading', 'processing', 'ready', 'failed', 'rejected', 'deleted');
CREATE TYPE highlight_source       AS ENUM ('host_manual', 'ai_generated', 'player_upload');
CREATE TYPE highlight_visibility   AS ENUM ('public', 'participants', 'private');
CREATE TYPE moderation_status      AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE reaction_type          AS ENUM ('like', 'fire', 'clap');
CREATE TYPE notification_channel   AS ENUM ('push', 'sms', 'telegram', 'email', 'in_app');
CREATE TYPE notification_status    AS ENUM ('queued', 'sent', 'delivered', 'failed', 'read');

-- =============================================================================
-- REFERENCE
-- =============================================================================
CREATE TABLE currencies (
  code        char(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  minor_unit  smallint NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),   -- UZS = 2 (tiyin)
  symbol      text     NOT NULL,
  name        jsonb    NOT NULL DEFAULT '{}'
);

CREATE TABLE countries (
  code              char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name              jsonb   NOT NULL,
  default_currency  char(3) NOT NULL REFERENCES currencies(code),
  default_locale    text    NOT NULL,
  phone_prefix      text    NOT NULL,
  data_region       text    NOT NULL,          -- cell: 'uz-1', 'eu-1', 'me-1' (data residency)
  is_active         boolean NOT NULL DEFAULT false
);

CREATE TABLE cities (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code      char(2) NOT NULL REFERENCES countries(code),
  slug              text    NOT NULL UNIQUE,
  name              jsonb   NOT NULL,
  timezone          text    NOT NULL,          -- IANA, masalan 'Asia/Tashkent'
  center            geography(Point, 4326) NOT NULL,
  default_currency  char(3) NOT NULL REFERENCES currencies(code),
  is_active         boolean NOT NULL DEFAULT false
);

CREATE TABLE sports (
  id                        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                      text     NOT NULL UNIQUE,   -- 'football', 'basketball'
  name                      jsonb    NOT NULL,
  default_players_per_side  smallint NOT NULL CHECK (default_players_per_side > 0),
  is_active                 boolean  NOT NULL DEFAULT true
);

-- Faqat hisobot uchun. Checkout'da hech qachon FX konvertatsiya qilinmaydi.
CREATE TABLE fx_rates (
  base_currency   char(3)        NOT NULL REFERENCES currencies(code),
  quote_currency  char(3)        NOT NULL REFERENCES currencies(code),
  as_of           date           NOT NULL,
  rate            numeric(20,10) NOT NULL CHECK (rate > 0),
  source          text           NOT NULL,      -- 'cbu.uz', 'ecb'
  PRIMARY KEY (base_currency, quote_currency, as_of)
);

-- =============================================================================
-- IDENTITY
-- =============================================================================
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  phone_e164       text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email            citext UNIQUE,
  display_name     text NOT NULL,
  first_name       text,
  last_name        text,
  avatar_media_id  uuid,                                   -- FK media_assets yaratilgandan keyin qo'shiladi
  birth_date       date,
  gender           gender_value NOT NULL DEFAULT 'undisclosed',
  locale           text NOT NULL DEFAULT 'uz-Latn',        -- BCP 47
  country_code     char(2) NOT NULL REFERENCES countries(code),
  home_city_id     integer REFERENCES cities(id),
  data_region      text NOT NULL,                          -- PII qaysi cell'da saqlanadi
  status           user_status NOT NULL DEFAULT 'active',
  onboarded_at     timestamptz,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  anonymized_at    timestamptz,                            -- GDPR erasure: PII null/maskalangan
  CONSTRAINT users_deleted_consistency CHECK (status <> 'deleted' OR deleted_at IS NOT NULL)
);

-- M:N — bitta odam bir vaqtda player ham, host ham bo'lishi mumkin
CREATE TABLE user_roles (
  user_id     uuid      NOT NULL REFERENCES users(id),
  role        user_role NOT NULL,
  granted_by  uuid      REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid NOT NULL REFERENCES users(id),
  provider      auth_provider NOT NULL,
  provider_uid  text NOT NULL,             -- phone: E.164, google/apple: sub, telegram: user id
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  UNIQUE (provider, provider_uid)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- Refresh token rotation: har refresh'da yangi token, family_id bo'yicha reuse detection
CREATE TABLE user_sessions (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id             uuid  NOT NULL REFERENCES users(id),
  family_id           uuid  NOT NULL,
  refresh_token_hash  bytea NOT NULL UNIQUE,           -- SHA-256, token o'zi saqlanmaydi
  device_id           text,
  platform            device_platform,
  app_version         text,
  ip                  inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text
);
CREATE INDEX user_sessions_active_idx ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_sessions_family_idx ON user_sessions (family_id);

CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid NOT NULL REFERENCES users(id),
  platform     device_platform NOT NULL,
  push_token   text NOT NULL UNIQUE,
  locale       text NOT NULL,
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  disabled_at  timestamptz
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE disabled_at IS NULL;

-- =============================================================================
-- PROFILE
-- =============================================================================
CREATE TABLE player_sport_profiles (
  user_id             uuid     NOT NULL REFERENCES users(id),
  sport_id            smallint NOT NULL REFERENCES sports(id),
  self_level          skill_level NOT NULL DEFAULT 'beginner',
  rating              numeric(7,2) NOT NULL DEFAULT 1500,   -- Glicko-2, match'lardan keyin hisoblanadi
  rating_deviation    numeric(6,2) NOT NULL DEFAULT 350,
  games_played        integer  NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  no_show_count       integer  NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
  preferred_position  text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sport_id)
);

-- =============================================================================
-- CATALOG: venues, pitches, leases
-- =============================================================================
CREATE TABLE venues (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  city_id         integer NOT NULL REFERENCES cities(id),
  name            text  NOT NULL,
  slug            text  NOT NULL UNIQUE,
  description     jsonb NOT NULL DEFAULT '{}',
  address         jsonb NOT NULL DEFAULT '{}',
  location        geography(Point, 4326) NOT NULL,
  timezone        text  NOT NULL,
  partner_name    text,                     -- stadion egasi (biznes kontakt)
  partner_phone   text,
  contract_ref    text,
  cover_media_id  uuid,                     -- FK media_assets'dan keyin
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_location_gix ON venues USING gist (location);
CREATE INDEX venues_city_idx ON venues (city_id);

CREATE TABLE amenities (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code  text  NOT NULL UNIQUE,              -- 'parking', 'shower', 'lighting'
  name  jsonb NOT NULL,
  icon  text
);

CREATE TABLE venue_amenities (
  venue_id    uuid     NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  amenity_id  smallint NOT NULL REFERENCES amenities(id),
  PRIMARY KEY (venue_id, amenity_id)
);
CREATE INDEX venue_amenities_amenity_idx ON venue_amenities (amenity_id);

CREATE TABLE pitches (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  venue_id              uuid NOT NULL REFERENCES venues(id),
  name                  text NOT NULL,
  surface               surface_type NOT NULL,
  is_indoor             boolean NOT NULL DEFAULT false,
  length_m              numeric(5,1),
  width_m               numeric(5,1),
  max_players_per_side  smallint CHECK (max_players_per_side > 0),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE TABLE pitch_sports (
  pitch_id  uuid     NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  sport_id  smallint NOT NULL REFERENCES sports(id),
  PRIMARY KEY (pitch_id, sport_id)
);

-- Admin stadion egasidan vaqt slotini ijaraga oladi. Bitta maydonni bir vaqtda
-- ikki marta ijaraga olish DB darajasida imkonsiz (EXCLUDE constraint).
CREATE TABLE field_leases (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  pitch_id           uuid NOT NULL REFERENCES pitches(id),
  period             tstzrange NOT NULL,
  cost_amount        bigint  NOT NULL CHECK (cost_amount >= 0),
  currency           char(3) NOT NULL REFERENCES currencies(code),
  status             lease_status NOT NULL DEFAULT 'reserved',
  owner_invoice_ref  text,
  paid_to_owner_at   timestamptz,
  notes              text,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_leases_period_valid CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)),
  CONSTRAINT field_leases_no_overlap EXCLUDE USING gist (pitch_id WITH =, period WITH &&)
    WHERE (status <> 'cancelled')
);

-- =============================================================================
-- MATCHES
-- =============================================================================
-- rules misol: [{"min_hours_before":24,"refund_pct":100,"destination":"original_method"},
--               {"min_hours_before":3,"refund_pct":100,"destination":"wallet"},
--               {"min_hours_before":0,"refund_pct":0}]
CREATE TABLE cancellation_policies (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text    NOT NULL UNIQUE,
  name        jsonb   NOT NULL,
  rules       jsonb   NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
  is_default  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX cancellation_policies_one_default ON cancellation_policies (is_default) WHERE is_default;

-- Versiyalangan, har locale uchun alohida. Matn o'zgarsa — yangi version (eski satr o'zgarmaydi).
CREATE TABLE waiver_templates (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text     NOT NULL,                  -- 'general_liability'
  version         integer  NOT NULL CHECK (version > 0),
  locale          text     NOT NULL,
  country_code    char(2)  NOT NULL REFERENCES countries(code),
  sport_id        smallint REFERENCES sports(id),     -- NULL = barcha sportlar
  title           text     NOT NULL,
  body_md         text     NOT NULL,
  body_sha256     bytea    NOT NULL,                  -- trigger hisoblaydi
  min_age         smallint NOT NULL DEFAULT 16,
  effective_from  timestamptz NOT NULL,
  retired_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version, locale)
);

CREATE FUNCTION waiver_templates_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.body_sha256 := sha256(convert_to(NEW.body_md, 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER waiver_templates_hash_trg BEFORE INSERT ON waiver_templates
  FOR EACH ROW EXECUTE FUNCTION waiver_templates_hash();
CREATE TRIGGER waiver_templates_immutable_body BEFORE UPDATE OF code, version, locale, title, body_md, body_sha256
  ON waiver_templates FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE matches (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  public_code             text     NOT NULL UNIQUE,              -- 'MU-7F3K2' — support/QR uchun qisqa kod
  sport_id                smallint NOT NULL REFERENCES sports(id),
  pitch_id                uuid     NOT NULL REFERENCES pitches(id),
  lease_id                uuid     REFERENCES field_leases(id),
  city_id                 integer  NOT NULL REFERENCES cities(id),
  location                geography(Point, 4326) NOT NULL,       -- venue'dan denormalizatsiya (discovery bitta jadvalda)
  title                   jsonb    NOT NULL DEFAULT '{}',
  description             jsonb    NOT NULL DEFAULT '{}',
  starts_at               timestamptz NOT NULL,
  ends_at                 timestamptz NOT NULL,
  format                  text     NOT NULL,                     -- '7v7', '5v5'
  sides_count             smallint NOT NULL DEFAULT 2 CHECK (sides_count >= 2),
  players_per_side        smallint NOT NULL CHECK (players_per_side > 0),
  min_players             smallint NOT NULL,
  max_players             smallint NOT NULL,
  held_slots              smallint NOT NULL DEFAULT 0,           -- to'lov kutilayotgan joylar
  confirmed_slots         smallint NOT NULL DEFAULT 0,           -- to'langan joylar
  price_amount            bigint   NOT NULL CHECK (price_amount >= 0),
  currency                char(3)  NOT NULL REFERENCES currencies(code),
  skill_min               skill_level,
  skill_max               skill_level,
  gender_policy           match_gender_policy NOT NULL DEFAULT 'any',
  min_age                 smallint NOT NULL DEFAULT 16,
  visibility              match_visibility NOT NULL DEFAULT 'public',
  status                  match_status NOT NULL DEFAULT 'draft',
  waiver_template_code    text     NOT NULL DEFAULT 'general_liability',
  cancellation_policy_id  smallint NOT NULL REFERENCES cancellation_policies(id),
  booking_closes_at       timestamptz NOT NULL,                  -- masalan starts_at - 30 min
  min_players_deadline    timestamptz NOT NULL,                  -- shu vaqtgacha min_players bo'lmasa -> avto-bekor + refund
  host_fee_amount         bigint   NOT NULL DEFAULT 0 CHECK (host_fee_amount >= 0),
  published_at            timestamptz,
  cancelled_at            timestamptz,
  cancel_reason           text,
  completed_at            timestamptz,
  created_by              uuid     NOT NULL REFERENCES users(id),
  version                 integer  NOT NULL DEFAULT 1,           -- optimistic locking (admin tahriri)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_time_valid        CHECK (ends_at > starts_at),
  CONSTRAINT matches_players_valid     CHECK (min_players > 0 AND min_players <= max_players),
  -- Oversell'ga qarshi oxirgi himoya chizig'i (asosiy himoya — atomik UPDATE, db/queries/critical.sql)
  CONSTRAINT matches_capacity          CHECK (held_slots >= 0 AND confirmed_slots >= 0
                                              AND held_slots + confirmed_slots <= max_players),
  CONSTRAINT matches_deadlines_valid   CHECK (booking_closes_at <= starts_at AND min_players_deadline <= starts_at),
  CONSTRAINT matches_skill_range       CHECK (skill_min IS NULL OR skill_max IS NULL OR skill_min <= skill_max),
  CONSTRAINT matches_cancel_consistent CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
-- Discovery: geo + vaqt bitta composite GiST index'da (btree_gist)
CREATE INDEX matches_discovery_gix ON matches USING gist (location, starts_at)
  WHERE status IN ('open', 'full') AND visibility = 'public';
CREATE INDEX matches_city_time_idx  ON matches (city_id, starts_at)
  WHERE status IN ('open', 'full') AND visibility = 'public';
CREATE INDEX matches_sport_time_idx ON matches (sport_id, starts_at);
CREATE INDEX matches_lease_idx      ON matches (lease_id);
-- Background job'lar uchun: min_players deadline va booking yopilishi
CREATE INDEX matches_deadline_idx   ON matches (min_players_deadline) WHERE status = 'open';

-- Pickup'da jamoalar (Oranges vs Blues). Phase 2: team_id qo'shiladi -> liga o'yini ham shu struktura.
CREATE TABLE match_sides (
  match_id   uuid     NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side_no    smallint NOT NULL CHECK (side_no > 0),
  label      text     NOT NULL,
  bib_color  text,
  score      smallint CHECK (score >= 0),
  PRIMARY KEY (match_id, side_no)
);

-- Imzo — huquqiy dalil: hash snapshot, IP, UA, vaqt. O'zgartirib bo'lmaydi.
CREATE TABLE waiver_signatures (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid  NOT NULL REFERENCES users(id),
  template_id        uuid  NOT NULL REFERENCES waiver_templates(id),
  document_sha256    bytea NOT NULL,                 -- imzolangan paytdagi matn hash'i
  method             waiver_sign_method NOT NULL,
  typed_full_name    text,
  otp_challenge_ref  text,                           -- method = otp_confirmed bo'lsa
  signed_at          timestamptz NOT NULL DEFAULT now(),
  ip                 inet,
  user_agent         text,
  app_version        text,
  device_id          text,
  guardian_name      text,                           -- voyaga yetmaganlar uchun
  guardian_phone     text,
  guardian_relation  text,
  match_id           uuid REFERENCES matches(id),    -- imzo qaysi checkout kontekstida olingan
  CONSTRAINT waiver_signatures_otp CHECK (method <> 'otp_confirmed' OR otp_challenge_ref IS NOT NULL)
);
CREATE INDEX waiver_signatures_user_tpl_idx ON waiver_signatures (user_id, template_id);

-- =============================================================================
-- BOOKING
-- =============================================================================
-- Exclusive-arc: bookable_type qaysi FK to'ldirilganini belgilaydi.
-- Phase 2 faqat yangi enum qiymati + ustun + CHECK qo'shadi (0002 ga qarang).
CREATE TABLE bookings (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id                uuid     NOT NULL REFERENCES users(id),      -- to'lovchi
  bookable_type          booking_target NOT NULL DEFAULT 'match_slot',
  match_id               uuid     REFERENCES matches(id),
  seats                  smallint NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 4),   -- o'zi + 3 ta mehmon
  unit_price_amount      bigint   NOT NULL CHECK (unit_price_amount >= 0),
  discount_amount        bigint   NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  wallet_applied_amount  bigint   NOT NULL DEFAULT 0 CHECK (wallet_applied_amount >= 0),
  total_amount           bigint   NOT NULL CHECK (total_amount >= 0),  -- provider'ga to'lanadigan summa
  currency               char(3)  NOT NULL REFERENCES currencies(code),
  status                 booking_status NOT NULL DEFAULT 'pending_payment',
  waiver_signature_id    uuid     REFERENCES waiver_signatures(id),
  idempotency_key        text     NOT NULL,
  expires_at             timestamptz,                                  -- seat hold muddati
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  cancelled_by           uuid     REFERENCES users(id),
  cancel_reason          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT bookings_target_arc CHECK (bookable_type = 'match_slot' AND match_id IS NOT NULL),
  CONSTRAINT bookings_amount_math CHECK (
    total_amount = unit_price_amount * seats - discount_amount - wallet_applied_amount),
  CONSTRAINT bookings_hold_has_expiry CHECK (status <> 'pending_payment' OR expires_at IS NOT NULL),
  -- Waiver imzolanmagan match booking'i DB darajasida imkonsiz
  CONSTRAINT bookings_waiver_required CHECK (bookable_type <> 'match_slot' OR waiver_signature_id IS NOT NULL)
);
CREATE INDEX bookings_user_idx    ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_match_idx   ON bookings (match_id);
CREATE INDEX bookings_expiry_idx  ON bookings (expires_at) WHERE status = 'pending_payment';

-- Roster (kim o'ynaydi) to'lovdan (kim to'ladi) alohida:
-- admin taklifi, host walk-in, mehmonlar (+1) va Phase 2 team roster ham shu jadvalda.
CREATE TABLE match_participants (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id       uuid NOT NULL REFERENCES matches(id),
  booking_id     uuid REFERENCES bookings(id),
  user_id        uuid REFERENCES users(id),
  guest_name     text,
  side_no        smallint,
  status         participant_status NOT NULL DEFAULT 'held',
  source         participant_source NOT NULL DEFAULT 'booking',
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (match_id, side_no) REFERENCES match_sides(match_id, side_no),
  CONSTRAINT match_participants_identity CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL),
  CONSTRAINT match_participants_source   CHECK (source <> 'booking' OR booking_id IS NOT NULL)
);
-- Bitta odam bitta match'ga faqat bir marta faol yozilishi mumkin
CREATE UNIQUE INDEX match_participants_one_active_per_user ON match_participants (match_id, user_id)
  WHERE user_id IS NOT NULL AND status IN ('held', 'confirmed', 'checked_in', 'no_show');
CREATE INDEX match_participants_booking_idx ON match_participants (booking_id);
CREATE INDEX match_participants_user_idx    ON match_participants (user_id, created_at DESC);

CREATE TABLE match_waitlist (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id          uuid NOT NULL REFERENCES matches(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  status            waitlist_status NOT NULL DEFAULT 'waiting',
  notified_at       timestamptz,
  offer_expires_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX match_waitlist_one_active ON match_waitlist (match_id, user_id)
  WHERE status IN ('waiting', 'notified');
CREATE INDEX match_waitlist_queue_idx ON match_waitlist (match_id, created_at) WHERE status = 'waiting';

-- =============================================================================
-- PAYMENTS
-- =============================================================================
-- Qaysi davlatda qaysi provider qaysi tartibda ko'rsatiladi. Secret'lar DB'da emas — faqat havola.
CREATE TABLE payment_provider_configs (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code  char(2)  NOT NULL REFERENCES countries(code),
  provider      payment_provider NOT NULL,
  currencies    char(3)[] NOT NULL,
  priority      smallint NOT NULL DEFAULT 100,
  is_enabled    boolean  NOT NULL DEFAULT false,
  merchant_id   text,                       -- maxfiy emas (Payme merchant id, Click service_id)
  secret_ref    text     NOT NULL,          -- 'vault:kv/payments/payme-uz'
  settings      jsonb    NOT NULL DEFAULT '{}',
  UNIQUE (country_code, provider)
);

CREATE TABLE payments (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id               uuid    NOT NULL REFERENCES bookings(id),
  user_id                  uuid    NOT NULL REFERENCES users(id),
  provider                 payment_provider NOT NULL,
  amount                   bigint  NOT NULL CHECK (amount >= 0),
  currency                 char(3) NOT NULL REFERENCES currencies(code),
  status                   payment_status NOT NULL DEFAULT 'created',
  provider_transaction_id  text,                               -- Payme: params.id, Click: click_trans_id, Stripe: pi_...
  -- Provider-specific holat. Payme: {"state":2,"create_time":..,"perform_time":..,"cancel_time":..,"reason":null}
  provider_state           jsonb   NOT NULL DEFAULT '{}',
  checkout_url             text,
  failure_code             text,
  failure_message          text,
  refunded_amount          bigint  NOT NULL DEFAULT 0,
  authorized_at            timestamptz,
  succeeded_at             timestamptz,
  failed_at                timestamptz,
  cancelled_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id),
  CONSTRAINT payments_refund_bounds CHECK (refunded_amount >= 0 AND refunded_amount <= amount)
);
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_open_idx    ON payments (created_at) WHERE status IN ('created', 'pending', 'authorized');
-- Bitta booking ikki marta muvaffaqiyatli to'lanmaydi
CREATE UNIQUE INDEX payments_one_success_per_booking ON payments (booking_id)
  WHERE status IN ('succeeded', 'partially_refunded', 'refunded');

-- Inbox pattern: har bir webhook avval shu yerga yoziladi -> dublikatlar UNIQUE bilan to'xtaydi
CREATE TABLE payment_events (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  provider           payment_provider NOT NULL,
  provider_event_id  text    NOT NULL,     -- Stripe: evt_..., Click: click_trans_id:action, Payme: method:params.id
  event_type         text    NOT NULL,
  payment_id         uuid    REFERENCES payments(id),
  payload            jsonb   NOT NULL,
  signature_valid    boolean NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  processing_error   text,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_events_unprocessed_idx ON payment_events (received_at) WHERE processed_at IS NULL;

CREATE TABLE refunds (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  payment_id          uuid    REFERENCES payments(id),
  booking_id          uuid    NOT NULL REFERENCES bookings(id),
  amount              bigint  NOT NULL CHECK (amount > 0),
  currency            char(3) NOT NULL REFERENCES currencies(code),
  destination         refund_destination NOT NULL,
  status              refund_status NOT NULL DEFAULT 'pending',
  reason              text    NOT NULL,     -- 'user_cancel' | 'match_cancelled' | 'late_payment_no_seat'
  provider_refund_id  text,
  initiated_by        uuid    REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT refunds_original_needs_payment CHECK (destination = 'wallet' OR payment_id IS NOT NULL)
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);

-- Wallet: tezkor refund (provider komissiyasisiz) va retention uchun kredit
CREATE TABLE wallet_accounts (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid    NOT NULL REFERENCES users(id),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  balance     bigint  NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

CREATE TABLE wallet_transactions (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  wallet_id      uuid   NOT NULL REFERENCES wallet_accounts(id),
  type           wallet_txn_type NOT NULL,
  amount         bigint NOT NULL CHECK (amount <> 0),       -- ishorali: +kredit / -debit
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  booking_id     uuid   REFERENCES bookings(id),
  refund_id      uuid   REFERENCES refunds(id),
  expires_at     timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_transactions_wallet_idx ON wallet_transactions (wallet_id, created_at DESC);

-- =============================================================================
-- COMPLIANCE: consents, DSR, audit
-- =============================================================================
CREATE TABLE consents (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id           uuid    NOT NULL REFERENCES users(id),
  purpose           consent_purpose NOT NULL,
  granted           boolean NOT NULL,
  document_version  text,                  -- 'privacy-2026-09'
  source            text    NOT NULL,      -- 'onboarding' | 'settings' | 'checkout'
  ip                inet,
  user_agent        text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_purpose_idx ON consents (user_id, purpose, recorded_at DESC);

CREATE VIEW user_current_consents AS
SELECT DISTINCT ON (user_id, purpose)
       user_id, purpose, granted, document_version, recorded_at
FROM consents
ORDER BY user_id, purpose, recorded_at DESC;

CREATE TABLE data_subject_requests (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid NOT NULL REFERENCES users(id),
  type             dsr_type   NOT NULL,
  status           dsr_status NOT NULL DEFAULT 'received',
  requested_at     timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz NOT NULL DEFAULT now() + interval '30 days',   -- GDPR Art. 12(3)
  completed_at     timestamptz,
  export_media_id  uuid,                    -- FK media_assets'dan keyin
  handled_by       uuid REFERENCES users(id),
  notes            text
);
CREATE INDEX dsr_open_idx ON data_subject_requests (due_at) WHERE status IN ('received', 'in_progress');

CREATE TABLE audit_logs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid REFERENCES users(id),
  actor_role     user_role,
  action         text  NOT NULL,           -- 'match.cancel', 'refund.create', 'user.erase'
  entity_type    text  NOT NULL,
  entity_id      uuid,
  changes        jsonb NOT NULL DEFAULT '{}',
  ip             inet,
  request_id     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_user_id, created_at DESC);

-- =============================================================================
-- HOST OPS (gig economy)
-- =============================================================================
CREATE TABLE host_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id),
  status              host_status NOT NULL DEFAULT 'applicant',
  home_city_id        integer NOT NULL REFERENCES cities(id),
  base_location       geography(Point, 4326),               -- dispatch: eng yaqin hostlar
  max_travel_km       smallint NOT NULL DEFAULT 10,
  has_kit             boolean  NOT NULL DEFAULT false,      -- bib, to'p, konus
  kit_notes           text,
  rating_avg          numeric(3,2),
  rating_count        integer  NOT NULL DEFAULT 0,
  completed_matches   integer  NOT NULL DEFAULT 0,
  no_show_count       integer  NOT NULL DEFAULT 0,
  payout_method       text,                                 -- 'card_uzcard' | 'card_humo' | 'bank'
  payout_details_ref  text,                                 -- tokenized/vault havola (karta raqami saqlanmaydi)
  verified_at         timestamptz,
  verified_by         uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX host_profiles_location_gix ON host_profiles USING gist (base_location) WHERE status = 'active';

CREATE TABLE host_sports (
  user_id   uuid     NOT NULL REFERENCES host_profiles(user_id) ON DELETE CASCADE,
  sport_id  smallint NOT NULL REFERENCES sports(id),
  PRIMARY KEY (user_id, sport_id)
);

CREATE TABLE host_payouts (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  host_user_id       uuid    NOT NULL REFERENCES host_profiles(user_id),
  period_start       date    NOT NULL,
  period_end         date    NOT NULL,
  amount             bigint  NOT NULL CHECK (amount >= 0),
  currency           char(3) NOT NULL REFERENCES currencies(code),
  status             payout_status NOT NULL DEFAULT 'pending',
  assignments_count  integer NOT NULL,
  provider_ref       text,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_user_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE host_assignments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id            uuid    NOT NULL REFERENCES matches(id),
  host_user_id        uuid    NOT NULL REFERENCES host_profiles(user_id),
  status              host_assignment_status NOT NULL DEFAULT 'offered',
  dispatch_round      smallint NOT NULL DEFAULT 1,
  fee_amount          bigint  NOT NULL CHECK (fee_amount >= 0),
  currency            char(3) NOT NULL REFERENCES currencies(code),
  offered_at          timestamptz NOT NULL DEFAULT now(),
  offer_expires_at    timestamptz NOT NULL,
  responded_at        timestamptz,
  decline_reason      text,
  arrived_at          timestamptz,
  arrival_location    geography(Point, 4326),
  arrival_distance_m  integer,
  completed_at        timestamptz,
  payout_id           uuid REFERENCES host_payouts(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, host_user_id)
);
-- Bitta match'ga faqat bitta faol host (birinchi accept qilgan yutadi)
CREATE UNIQUE INDEX host_assignments_one_active_per_match ON host_assignments (match_id)
  WHERE status IN ('accepted', 'arrived', 'completed');
CREATE INDEX host_assignments_host_idx   ON host_assignments (host_user_id, status);
CREATE INDEX host_assignments_offers_idx ON host_assignments (offer_expires_at) WHERE status = 'offered';

-- Append-only. Host app offline ishlaydi -> client_event_id bilan idempotent sync.
CREATE TABLE checkin_events (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id            uuid NOT NULL REFERENCES matches(id),
  participant_id      uuid NOT NULL REFERENCES match_participants(id),
  host_assignment_id  uuid REFERENCES host_assignments(id),
  actor_user_id       uuid NOT NULL REFERENCES users(id),
  action              checkin_action NOT NULL,
  method              checkin_method NOT NULL,
  client_event_id     uuid NOT NULL UNIQUE,
  occurred_at         timestamptz NOT NULL,         -- qurilma vaqti
  received_at         timestamptz NOT NULL DEFAULT now(),
  device_location     geography(Point, 4326),
  device_id           text
);
CREATE INDEX checkin_events_match_idx ON checkin_events (match_id, occurred_at);

CREATE TABLE match_feedback (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id      uuid NOT NULL REFERENCES matches(id),
  from_user_id  uuid NOT NULL REFERENCES users(id),
  target        feedback_target NOT NULL,
  to_user_id    uuid REFERENCES users(id),          -- target = host/player bo'lsa
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags          text[] NOT NULL DEFAULT '{}',       -- 'on_time', 'fair_teams', 'rough_play'
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_feedback_unique UNIQUE NULLS NOT DISTINCT (match_id, from_user_id, target, to_user_id),
  CONSTRAINT match_feedback_target_user CHECK ((target IN ('host', 'player')) = (to_user_id IS NOT NULL))
);

-- =============================================================================
-- MEDIA
-- =============================================================================
CREATE TABLE media_assets (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_user_id    uuid REFERENCES users(id),
  kind             media_kind   NOT NULL,
  status           media_status NOT NULL DEFAULT 'uploading',
  storage_region   text NOT NULL,                 -- cell: 'uz-1' (MVP: AWS S3 Frankfurt); biometrik bo'lsa — UZ ichidagi storage
  bucket           text NOT NULL,
  object_key       text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       bigint CHECK (size_bytes >= 0),
  duration_ms      integer CHECK (duration_ms >= 0),
  width            integer,
  height           integer,
  checksum_sha256  bytea,
  upload_id        text,                          -- S3 multipart upload id
  playback_path    text,                          -- HLS manifest key
  thumbnail_key    text,
  recorded_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (bucket, object_key)
);
CREATE INDEX media_assets_owner_idx ON media_assets (owner_user_id);

ALTER TABLE users                 ADD CONSTRAINT users_avatar_fk  FOREIGN KEY (avatar_media_id) REFERENCES media_assets(id);
ALTER TABLE venues                ADD CONSTRAINT venues_cover_fk  FOREIGN KEY (cover_media_id)  REFERENCES media_assets(id);
ALTER TABLE data_subject_requests ADD CONSTRAINT dsr_export_fk    FOREIGN KEY (export_media_id) REFERENCES media_assets(id);

CREATE TABLE highlights (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id           uuid NOT NULL REFERENCES matches(id),
  media_asset_id     uuid NOT NULL UNIQUE REFERENCES media_assets(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  source             highlight_source NOT NULL,
  title              text,
  clip_started_at    timestamptz,                -- devor soati bo'yicha
  match_offset_ms    integer CHECK (match_offset_ms >= 0),   -- kick-off'dan beri
  duration_ms        integer CHECK (duration_ms > 0),
  visibility         highlight_visibility NOT NULL DEFAULT 'participants',
  moderation_status  moderation_status    NOT NULL DEFAULT 'pending',
  likes_count        integer NOT NULL DEFAULT 0,  -- denormalizatsiya, worker yangilaydi
  shares_count       integer NOT NULL DEFAULT 0,
  views_count        bigint  NOT NULL DEFAULT 0,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX highlights_match_idx ON highlights (match_id);
CREATE INDEX highlights_feed_idx  ON highlights (published_at DESC)
  WHERE visibility = 'public' AND moderation_status = 'approved' AND deleted_at IS NULL;

-- Teg faqat media_appearance consent'i bor userlar uchun (app tekshiradi)
CREATE TABLE highlight_tags (
  highlight_id  uuid NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  tagged_by     uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (highlight_id, user_id)
);
CREATE INDEX highlight_tags_user_idx ON highlight_tags (user_id);

CREATE TABLE highlight_reactions (
  highlight_id  uuid NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  type          reaction_type NOT NULL DEFAULT 'like',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (highlight_id, user_id, type)
);

CREATE TABLE highlight_shares (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  highlight_id  uuid NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id),
  channel       text NOT NULL,              -- 'telegram' | 'instagram' | 'link'
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX highlight_shares_highlight_idx ON highlight_shares (highlight_id);

-- =============================================================================
-- PLATFORM: notifications, transactional outbox
-- =============================================================================
CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id              uuid NOT NULL REFERENCES users(id),
  type                 text NOT NULL,              -- 'booking.confirmed', 'match.reminder_2h'
  channel              notification_channel NOT NULL,
  status               notification_status  NOT NULL DEFAULT 'queued',
  locale               text  NOT NULL,
  payload              jsonb NOT NULL,
  provider_message_id  text,
  error                text,
  scheduled_for        timestamptz,
  sent_at              timestamptz,
  read_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Domain event'lar biznes o'zgarish bilan BIR tranzaksiyada yoziladi, relay worker
-- ularni Redis/SQS'ga chiqaradi. Bu modular monolith -> microservice o'tishining asosi.
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  aggregate_type  text  NOT NULL,           -- 'booking', 'match', 'payment'
  aggregate_id    uuid  NOT NULL,
  event_type      text  NOT NULL,           -- 'BookingConfirmed', 'MatchFull'
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;

-- =============================================================================
-- TRIGGER'LAR
-- =============================================================================
-- updated_at ustuni bor barcha jadvallar uchun avtomatik trigger
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('CREATE TRIGGER %s_set_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   replace(t::text, '.', '_'), t);
  END LOOP;
END $$;

-- Append-only jadvallar: huquqiy dalil va moliyaviy tarix
CREATE TRIGGER waiver_signatures_append_only   BEFORE UPDATE OR DELETE ON waiver_signatures   FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER consents_append_only            BEFORE UPDATE OR DELETE ON consents            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER checkin_events_append_only      BEFORE UPDATE OR DELETE ON checkin_events      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER wallet_transactions_append_only BEFORE UPDATE OR DELETE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only          BEFORE UPDATE OR DELETE ON audit_logs          FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
