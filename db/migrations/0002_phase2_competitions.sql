-- =============================================================================
-- Match Up — 0002: Phase 2 (Teams, Leagues, Tournaments, match stats, AI media jobs)
--
-- FAQAT ADDITIVE: yangi jadvallar, nullable ustunlar, enum qiymatlari va bitta CHECK
-- almashtirish. users / bookings / payments / match_participants logikasi o'zgarmaydi:
--   * Liga o'yini = oddiy `matches` qatori + competition_id; jamoalar = match_sides.team_id.
--   * Jamoa ro'yxatdan o'tish to'lovi = oddiy `bookings` qatori (bookable_type = 'competition_entry')
--     -> o'sha checkout, o'sha payment adapter'lar, o'sha webhook'lar.
--   * Jamoa a'zolari match'da = match_participants (source = 'team_roster') -> o'sha check-in.
-- Postgres'da nullable ustun qo'shish metadata-only (jadval qayta yozilmaydi).
-- =============================================================================

-- Enum qiymatlari tranzaksiyadan oldin commit qilinishi kerak: yangi qiymatni o'sha
-- tranzaksiyada CHECK ichida ishlatib bo'lmaydi.
ALTER TYPE booking_target     ADD VALUE IF NOT EXISTS 'competition_entry';
ALTER TYPE participant_source ADD VALUE IF NOT EXISTS 'team_roster';

-- migrate:split  (runner shu yerda bo'ladi: yuqoridagi enum qiymatlari alohida commit qilinadi)

BEGIN;

CREATE TYPE team_member_role      AS ENUM ('captain', 'vice_captain', 'player');
CREATE TYPE team_member_status    AS ENUM ('invited', 'active', 'left', 'removed');
CREATE TYPE competition_type      AS ENUM ('league', 'tournament', 'cup');
CREATE TYPE competition_status    AS ENUM ('draft', 'registration_open', 'registration_closed',
                                           'in_progress', 'completed', 'cancelled');
CREATE TYPE entry_fee_mode        AS ENUM ('per_team', 'per_player');
CREATE TYPE entry_status          AS ENUM ('pending_payment', 'confirmed', 'withdrawn', 'disqualified');
CREATE TYPE match_event_type      AS ENUM ('goal', 'own_goal', 'assist', 'yellow_card', 'red_card',
                                           'save', 'mvp_vote', 'period_start', 'period_end');
CREATE TYPE match_event_source    AS ENUM ('host', 'referee', 'ai');
CREATE TYPE processing_job_type   AS ENUM ('transcode', 'thumbnail', 'ai_detect_events', 'ai_auto_clip', 'face_blur');
CREATE TYPE processing_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- -----------------------------------------------------------------------------
-- Teams
-- -----------------------------------------------------------------------------
CREATE TABLE teams (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  sport_id         smallint NOT NULL REFERENCES sports(id),
  city_id          integer  NOT NULL REFERENCES cities(id),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  logo_media_id    uuid REFERENCES media_assets(id),
  captain_user_id  uuid NOT NULL REFERENCES users(id),
  skill_level      skill_level,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  role           team_member_role   NOT NULL DEFAULT 'player',
  status         team_member_status NOT NULL DEFAULT 'invited',
  jersey_number  smallint CHECK (jersey_number BETWEEN 0 AND 99),
  joined_at      timestamptz,
  left_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE UNIQUE INDEX team_members_one_captain ON team_members (team_id) WHERE role = 'captain' AND status = 'active';
CREATE INDEX team_members_user_idx ON team_members (user_id) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- Competitions (league / tournament / cup)
-- -----------------------------------------------------------------------------
CREATE TABLE competitions (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  type                     competition_type NOT NULL,
  sport_id                 smallint NOT NULL REFERENCES sports(id),
  city_id                  integer  NOT NULL REFERENCES cities(id),
  name                     jsonb NOT NULL,
  slug                     text  NOT NULL UNIQUE,
  season                   text,
  -- {"stages":[{"type":"round_robin","groups":4},{"type":"knockout","qualifiers_per_group":2}]}
  format                   jsonb NOT NULL DEFAULT '{}',
  team_size_min            smallint NOT NULL,
  team_size_max            smallint NOT NULL,
  max_teams                smallint,
  entry_fee_amount         bigint  NOT NULL DEFAULT 0 CHECK (entry_fee_amount >= 0),
  entry_fee_mode           entry_fee_mode NOT NULL DEFAULT 'per_team',
  currency                 char(3) NOT NULL REFERENCES currencies(code),
  registration_opens_at    timestamptz,
  registration_closes_at   timestamptz,
  starts_on                date,
  ends_on                  date,
  status                   competition_status NOT NULL DEFAULT 'draft',
  waiver_template_code     text NOT NULL DEFAULT 'general_liability',
  cancellation_policy_id   smallint NOT NULL REFERENCES cancellation_policies(id),
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (team_size_min > 0 AND team_size_min <= team_size_max),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX competitions_city_status_idx ON competitions (city_id, status);

CREATE TABLE competition_entries (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id  uuid NOT NULL REFERENCES competitions(id),
  team_id         uuid NOT NULL REFERENCES teams(id),
  status          entry_status NOT NULL DEFAULT 'pending_payment',
  seed            smallint,
  group_label     text,
  registered_by   uuid NOT NULL REFERENCES users(id),
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, team_id)
);

-- -----------------------------------------------------------------------------
-- Mavjud core jadvallarga additive ustunlar
-- -----------------------------------------------------------------------------
ALTER TABLE matches
  ADD COLUMN competition_id uuid REFERENCES competitions(id),
  ADD COLUMN round_label    text;                      -- 'Group A — Round 2', 'Semi-final'
CREATE INDEX matches_competition_idx ON matches (competition_id) WHERE competition_id IS NOT NULL;

ALTER TABLE match_sides
  ADD COLUMN team_id uuid REFERENCES teams(id);        -- pickup'da NULL, liga o'yinida jamoa
CREATE INDEX match_sides_team_idx ON match_sides (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE bookings
  ADD COLUMN competition_entry_id uuid REFERENCES competition_entries(id);
CREATE INDEX bookings_competition_entry_idx ON bookings (competition_entry_id) WHERE competition_entry_id IS NOT NULL;

-- Exclusive-arc CHECK'ni kengaytirish. NOT VALID + VALIDATE: katta jadvalda yozishni
-- bloklamasdan tekshirish (VALIDATE faqat SHARE UPDATE EXCLUSIVE lock oladi).
ALTER TABLE bookings DROP CONSTRAINT bookings_target_arc;
ALTER TABLE bookings ADD CONSTRAINT bookings_target_arc CHECK (
     (bookable_type = 'match_slot'        AND match_id IS NOT NULL AND competition_entry_id IS NULL)
  OR (bookable_type = 'competition_entry' AND competition_entry_id IS NOT NULL AND match_id IS NULL)
) NOT VALID;
ALTER TABLE bookings VALIDATE CONSTRAINT bookings_target_arc;

-- -----------------------------------------------------------------------------
-- Match statistikasi (host/referee kiritadi yoki AI aniqlaydi) — AI highlight timestamp'lari
-- -----------------------------------------------------------------------------
CREATE TABLE match_events (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id         uuid NOT NULL REFERENCES matches(id),
  side_no          smallint,
  participant_id   uuid REFERENCES match_participants(id),
  type             match_event_type   NOT NULL,
  source           match_event_source NOT NULL DEFAULT 'host',
  match_offset_ms  integer NOT NULL CHECK (match_offset_ms >= 0),
  occurred_at      timestamptz,
  confidence       numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),   -- source = 'ai'
  highlight_id     uuid REFERENCES highlights(id),
  recorded_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (match_id, side_no) REFERENCES match_sides(match_id, side_no)
);
CREATE INDEX match_events_match_idx ON match_events (match_id, match_offset_ms);
CREATE INDEX match_events_participant_idx ON match_events (participant_id) WHERE participant_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Media processing (Python worker'lar: FFmpeg, GPU AI)
-- -----------------------------------------------------------------------------
CREATE TABLE media_processing_jobs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  media_asset_id  uuid NOT NULL REFERENCES media_assets(id),
  type            processing_job_type   NOT NULL,
  status          processing_job_status NOT NULL DEFAULT 'queued',
  worker_version  text,
  attempts        smallint NOT NULL DEFAULT 0,
  input           jsonb NOT NULL DEFAULT '{}',
  output          jsonb,
  error           text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX media_processing_jobs_queue_idx ON media_processing_jobs (status, queued_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX media_processing_jobs_asset_idx ON media_processing_jobs (media_asset_id);

-- -----------------------------------------------------------------------------
-- Turnir jadvali (o'yinlar natijasidan hisoblanadi). Yuklama oshsa -> MATERIALIZED VIEW.
-- -----------------------------------------------------------------------------
CREATE VIEW competition_standings AS
WITH results AS (
  SELECT m.competition_id, ms.team_id, ms.score AS gf, opp.score AS ga
  FROM matches m
  JOIN match_sides ms  ON ms.match_id = m.id
  JOIN match_sides opp ON opp.match_id = m.id AND opp.side_no <> ms.side_no
  WHERE m.competition_id IS NOT NULL
    AND m.status = 'completed'
    AND ms.team_id IS NOT NULL
)
SELECT competition_id,
       team_id,
       count(*)                                   AS played,
       count(*) FILTER (WHERE gf > ga)            AS won,
       count(*) FILTER (WHERE gf = ga)            AS drawn,
       count(*) FILTER (WHERE gf < ga)            AS lost,
       sum(gf)                                    AS goals_for,
       sum(ga)                                    AS goals_against,
       sum(gf) - sum(ga)                          AS goal_diff,
       3 * count(*) FILTER (WHERE gf > ga) + count(*) FILTER (WHERE gf = ga) AS points
FROM results
GROUP BY competition_id, team_id;

-- updated_at trigger'lari yangi jadvallar uchun
CREATE TRIGGER teams_set_updated_at               BEFORE UPDATE ON teams               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER competitions_set_updated_at        BEFORE UPDATE ON competitions        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER competition_entries_set_updated_at BEFORE UPDATE ON competition_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
