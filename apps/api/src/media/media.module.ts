import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { AppError } from '../common/errors';
import { CurrentUser, Public, ReqLocale, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { HighlightsService, SHARE_CHANNELS } from './highlights.service';
import { MediaJobsService } from './media-jobs.service';
import { HIGHLIGHT_LIMITS, MediaService } from './media.service';
import { MEDIA_JOB_QUEUES, RedisStreamMediaQueue } from './queue';
import { CAMERA_POSITIONS, MARKER_SIDES, RECORDING_LIMITS, RIG_TYPES } from './recordings';
import { RecordingsService } from './recordings.service';
import { sharePage } from './share-page';
import { MediaUrlSigner, ObjectStorage } from './storage';
import { MediaTokens } from './tokens';

// ---------------------------------------------------------------------------
// Validatsiya sxemalari
// ---------------------------------------------------------------------------
export const HighlightUploadBody = z.object({
  content_type: z.enum(HIGHLIGHT_LIMITS.contentTypes),
  size_bytes: z.number().int().positive().max(HIGHLIGHT_LIMITS.maxBytes),
  duration_ms: z.number().int().positive().max(HIGHLIGHT_LIMITS.maxDurationMs),
  recorded_at: z.iso.datetime({ offset: true }).optional(),
  match_offset_ms: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  tagged_user_ids: z.array(z.uuid()).max(HIGHLIGHT_LIMITS.maxTags).optional(),
  tagged_participant_ids: z.array(z.uuid()).max(HIGHLIGHT_LIMITS.maxTags).optional(),
});

const CompleteBody = z.object({
  // Berilmasa — ETag'lar storage'dan (ListParts); katta yozuvlar uchun client yubormaydi
  parts: z
    .array(z.object({ part_number: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10_000)
    .optional(),
  checksum_sha256: z.string().max(100).optional(),
});

// --- AI-Cam A: to'liq o'yin yozuvi (host endpointlari host.module.ts da) ------------------------------
const Timestamp = z.iso.datetime({ offset: true });

export const CameraBody = z.object({
  position: z.enum(CAMERA_POSITIONS),
  started_at: Timestamp,
  stopped_at: Timestamp.nullable().optional(),
  duration_ms: z.number().int().min(0).max(RECORDING_LIMITS.maxDurationMs).optional(),
  device_model: z.string().trim().min(1).max(100).optional(),
  fps: z.number().positive().max(240).optional(),
  width: z.number().int().positive().max(16_384).optional(),
  height: z.number().int().positive().max(16_384).optional(),
  rig_type: z.enum(RIG_TYPES).optional(),
});

export const CameraUploadBody = z.object({
  content_type: z.enum(RECORDING_LIMITS.contentTypes),
  size_bytes: z.number().int().positive().max(RECORDING_LIMITS.maxBytes),
  duration_ms: z.number().int().positive().max(RECORDING_LIMITS.maxDurationMs),
});

export const MarkersBody = z.object({
  markers: z
    .array(
      z
        .object({
          client_marker_id: z.uuid(),
          kind: z.enum(['highlight', 'kickoff']),
          occurred_at: Timestamp,
          side: z.enum(MARKER_SIDES).nullable().optional(),
          participant_id: z.uuid().nullable().optional(),
          pre_ms: z.number().int().min(0).max(55_000).optional(),
          post_ms: z.number().int().min(0).max(30_000).optional(),
        })
        .refine((m) => {
          const len = (m.pre_ms ?? 12_000) + (m.post_ms ?? 3_000);
          return len >= 3_000 && len <= 60_000;
        }, 'pre_ms + post_ms 3..60 s bo\'lishi kerak'),
    )
    .min(1)
    .max(100),
});

const FeedQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const MyFeedQuery = FeedQuery.extend({ scope: z.enum(['all', 'tagged']).default('all') });
const ShareBody = z.object({ channel: z.enum(SHARE_CHANNELS).default('link') }).default({ channel: 'link' });

const Rendition = z.object({
  name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bandwidth: z.number().int().positive(),
  codecs: z.string().max(100).optional(),
  playlist_key: z.string().max(1024),
});
const JobStartBody = z.object({ worker_version: z.string().min(1).max(100) });
const JobProgressBody = z.object({ stage: z.string().regex(/^[a-z_]{1,32}$/) });
const JobResultBody = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    worker_version: z.string().min(1).max(100),
    output: z.object({
      hls_master_key: z.string().max(1024),
      renditions: z.array(Rendition).min(1).max(8),
      thumbnail_key: z.string().max(1024),
      vertical_key: z.string().max(1024).nullable().optional(),
      duration_ms: z.number().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      has_audio: z.boolean().optional(),
      probe: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    status: z.literal('failed'),
    worker_version: z.string().min(1).max(100),
    error_code: z.string().regex(/^[A-Z0-9_]{1,64}$/),
    error_message: z.string().max(2000).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Media (host yuklash oqimi)
// ---------------------------------------------------------------------------
@Controller('v1/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':mediaId')
  get(@Param('mediaId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.media.get(user.id, id);
  }

  /** Uzilgan yuklashni davom ettirish: yuklangan qismlar + qolganlari uchun yangi presigned URL'lar. */
  @Get(':mediaId/upload')
  resume(@Param('mediaId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.media.resumeUpload(user.id, id);
  }

  @Delete(':mediaId/upload')
  @HttpCode(204)
  async abort(@Param('mediaId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.media.abortUpload(user.id, id);
  }

  @Post(':mediaId/complete')
  @HttpCode(202)
  complete(@Param('mediaId', ParseUUIDPipe) id: string, @ZBody(CompleteBody) body: z.infer<typeof CompleteBody>, @CurrentUser() user: AuthUser) {
    return this.media.complete(user.id, id, body);
  }
}

// ---------------------------------------------------------------------------
// Player: feed, like, share
// ---------------------------------------------------------------------------
@Controller('v1')
export class HighlightsController {
  constructor(private readonly highlights: HighlightsService) {}

  @Get('matches/:matchId/highlights')
  matchFeed(@Param('matchId', ParseUUIDPipe) id: string, @ZQuery(FeedQuery) q: z.infer<typeof FeedQuery>, @CurrentUser() user: AuthUser) {
    return this.highlights.matchFeed(user, id, q.cursor, q.limit);
  }

  @Get('me/highlights')
  myFeed(@ZQuery(MyFeedQuery) q: z.infer<typeof MyFeedQuery>, @CurrentUser() user: AuthUser) {
    return this.highlights.myFeed(user.id, q.scope, q.cursor, q.limit);
  }

  @Get('highlights/:highlightId')
  get(@Param('highlightId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.highlights.get(user, id);
  }

  @Put('highlights/:highlightId/like')
  like(@Param('highlightId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.highlights.setLike(user, id, true);
  }

  @Delete('highlights/:highlightId/like')
  unlike(@Param('highlightId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.highlights.setLike(user, id, false);
  }

  @Post('highlights/:highlightId/share')
  @HttpCode(201)
  share(
    @Param('highlightId', ParseUUIDPipe) id: string,
    @ZBody(ShareBody) body: z.infer<typeof ShareBody>,
    @CurrentUser() user: AuthUser,
    @ReqLocale() locale: Locale,
  ) {
    return this.highlights.share(user, id, body.channel, locale);
  }

  /** Ochiq havola ma'lumoti (token = imzo, auth shart emas). */
  @Public()
  @Get('shared/highlights/:token')
  shared(@Param('token') token: string) {
    return this.highlights.shared(token);
  }
}

/** To'liq o'yin videosi (AI-Cam A) — ishtirokchilar uchun. */
@Controller('v1')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get('matches/:matchId/recording')
  get(@Param('matchId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recordings.viewerView(user, id);
  }
}

// ---------------------------------------------------------------------------
// Ijro: HLS playlist'lar (token URL'da — video player'lar Authorization header yubormaydi)
// ---------------------------------------------------------------------------
@Public()
@Controller('v1/playback')
export class PlaybackController {
  constructor(private readonly highlights: HighlightsService) {}

  @Get(':token/:file')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  // Ichidagi imzolar token muddati bilan tugaydi — qisqa private kesh
  @Header('Cache-Control', 'private, max-age=60')
  async playlist(@Param('token') token: string, @Param('file') file: string) {
    const m = /^([a-z0-9_-]{1,32})\.m3u8$/.exec(file);
    if (!m) throw new AppError('NOT_FOUND');
    return m[1] === 'master' ? this.highlights.masterPlaylist(token) : this.highlights.variantPlaylist(token, m[1]!);
  }
}

/** `/h/{token}` — Telegram/brauzerda ochiladigan ulashish sahifasi (og:image, video). */
@Public()
@Controller('h')
export class SharePageController {
  constructor(private readonly highlights: HighlightsService) {}

  @Get(':token')
  async page(@Param('token') token: string, @ReqLocale() locale: Locale, @Res() res: Response) {
    let data: Awaited<ReturnType<HighlightsService['shared']>> | undefined;
    try {
      data = await this.highlights.shared(token);
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'NOT_FOUND') throw err;
    }
    res
      .status(data ? 200 : 404)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src https: http:; media-src https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      })
      .send(sharePage(data, locale));
  }
}

// ---------------------------------------------------------------------------
// Ichki: Python media worker (servis token). Prod'da ALB `/internal/*` ni tashqariga ochmaydi.
// ---------------------------------------------------------------------------
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  private readonly token?: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.token = env.MEDIA_WORKER_TOKEN ? Buffer.from(env.MEDIA_WORKER_TOKEN) : undefined;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    if (!this.token || given.length !== this.token.length || !timingSafeEqual(given, this.token)) {
      throw new AppError('UNAUTHORIZED');
    }
    return true;
  }
}

@Public()
@UseGuards(WorkerTokenGuard)
@Controller('internal/media/jobs')
export class InternalMediaJobsController {
  constructor(private readonly jobs: MediaJobsService) {}

  @Post(':jobId/start')
  @HttpCode(200)
  start(@Param('jobId', ParseUUIDPipe) id: string, @ZBody(JobStartBody) body: z.infer<typeof JobStartBody>) {
    return this.jobs.start(id, body.worker_version);
  }

  @Post(':jobId/progress')
  @HttpCode(200)
  progress(@Param('jobId', ParseUUIDPipe) id: string, @ZBody(JobProgressBody) body: z.infer<typeof JobProgressBody>) {
    return this.jobs.progress(id, body.stage);
  }

  @Post(':jobId/result')
  @HttpCode(200)
  result(@Param('jobId', ParseUUIDPipe) id: string, @ZBody(JobResultBody) body: z.infer<typeof JobResultBody>) {
    return this.jobs.result(id, body);
  }
}

@Module({
  controllers: [MediaController, HighlightsController, RecordingsController, PlaybackController, SharePageController, InternalMediaJobsController],
  providers: [
    ObjectStorage,
    MediaUrlSigner,
    MediaTokens,
    RedisStreamMediaQueue,
    // Yangi transport (SQS + AWS Batch, AI-Cam) shu ro'yxatga qo'shiladi; JOB_ROUTES qaysi job qayerga ketishini belgilaydi
    { provide: MEDIA_JOB_QUEUES, inject: [RedisStreamMediaQueue], useFactory: (redis: RedisStreamMediaQueue) => [redis] },
    MediaService,
    MediaJobsService,
    HighlightsService,
    RecordingsService,
    WorkerTokenGuard,
  ],
  exports: [MediaService, HighlightsService, RecordingsService, ObjectStorage],
})
export class MediaModule {}
