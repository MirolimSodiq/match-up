import { Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, ReqLocale, Roles, ZBody, ZQuery, type AuthUser } from '../common/http';
import type { Locale } from '../common/i18n';
import { HighlightsService } from '../media/highlights.service';
import { CameraBody, CameraUploadBody, HighlightUploadBody, MarkersBody, MediaModule } from '../media/media.module';
import { MediaService } from '../media/media.service';
import { RecordingsService } from '../media/recordings.service';
import { DispatchService, HostService } from './host.service';

const GeoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const Decline = z.object({ reason: z.enum(['busy', 'too_far', 'other']).optional() }).default({});
const Scope = z.object({ scope: z.enum(['today', 'upcoming', 'past']).default('upcoming') });
const Arrive = z.object({ location: GeoPoint, accuracy_m: z.number().min(0).optional() });
const Checkins = z.object({
  events: z
    .array(
      z.object({
        client_event_id: z.uuid(),
        action: z.enum(['check_in', 'undo', 'no_show']),
        method: z.enum(['qr', 'manual']),
        qr_payload: z.string().max(1000).optional(),
        participant_id: z.uuid().optional(),
        occurred_at: z.iso.datetime({ offset: true }),
        location: GeoPoint.optional(),
      }),
    )
    .min(1)
    .max(100),
});
const ParticipantPatch = z
  .object({
    side_no: z.number().int().min(1).optional(),
    status: z.enum(['checked_in', 'no_show']).optional(),
    // null — raqamni olib tashlash
    bib_number: z.number().int().min(1).max(99).nullable().optional(),
  })
  .refine((v) => v.side_no !== undefined || v.status !== undefined || v.bib_number !== undefined, 'side_no, status yoki bib_number kerak');
const Complete = z.object({
  scores: z.array(z.object({ side_no: z.number().int().min(1), score: z.number().int().min(0).max(99) })).min(2),
  mvp_participant_id: z.uuid().nullable().optional(),
  incidents: z
    .array(
      z.object({
        type: z.enum(['injury', 'misconduct', 'venue_issue', 'other']),
        participant_id: z.uuid().nullable().optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .max(20)
    .optional(),
});

@Roles('host')
@Controller('v1/host')
export class HostController {
  constructor(
    private readonly host: HostService,
    private readonly media: MediaService,
    private readonly highlights: HighlightsService,
    private readonly recordings: RecordingsService,
  ) {}

  @Get('offers')
  offers(@CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.host.offers(user.id, locale);
  }

  @Post('offers/:assignmentId/accept')
  @HttpCode(200)
  accept(@Param('assignmentId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.host.accept(user.id, id, locale);
  }

  @Post('offers/:assignmentId/decline')
  @HttpCode(204)
  async decline(@Param('assignmentId', ParseUUIDPipe) id: string, @ZBody(Decline) body: z.infer<typeof Decline>, @CurrentUser() user: AuthUser) {
    await this.host.decline(user.id, id, body.reason);
  }

  @Get('matches')
  matches(@ZQuery(Scope) q: z.infer<typeof Scope>, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.host.matches(user.id, q.scope, locale);
  }

  @Get('matches/:matchId/roster')
  roster(@Param('matchId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.host.roster(user.id, id, locale);
  }

  @Post('matches/:matchId/arrive')
  @HttpCode(200)
  arrive(@Param('matchId', ParseUUIDPipe) id: string, @ZBody(Arrive) body: z.infer<typeof Arrive>, @CurrentUser() user: AuthUser) {
    return this.host.arrive(user.id, id, body.location);
  }

  @Post('matches/:matchId/checkins')
  @HttpCode(200)
  checkins(@Param('matchId', ParseUUIDPipe) id: string, @ZBody(Checkins) body: z.infer<typeof Checkins>, @CurrentUser() user: AuthUser) {
    return this.host.checkins(user.id, id, body.events);
  }

  @Patch('matches/:matchId/participants/:participantId')
  participant(
    @Param('matchId', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) pid: string,
    @ZBody(ParticipantPatch) body: z.infer<typeof ParticipantPatch>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.host.updateParticipant(user.id, id, pid, body);
  }

  @Post('matches/:matchId/complete')
  @HttpCode(200)
  complete(@Param('matchId', ParseUUIDPipe) id: string, @ZBody(Complete) body: z.infer<typeof Complete>, @CurrentUser() user: AuthUser, @ReqLocale() locale: Locale) {
    return this.host.complete(user.id, id, body, locale);
  }

  /** S3 multipart (presigned) — video API orqali o'tmaydi; `POST /v1/media/{id}/complete` bilan yakunlanadi. */
  @Post('matches/:matchId/highlights/uploads')
  @HttpCode(201)
  highlightUpload(
    @Param('matchId', ParseUUIDPipe) id: string,
    @ZBody(HighlightUploadBody) body: z.infer<typeof HighlightUploadBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.media.initHighlightUpload(user.id, id, body);
  }

  /** Shu match'ning kliplari (qayta ishlanayotgan va xato berganlari bilan). */
  @Get('matches/:matchId/highlights')
  async matchHighlights(@Param('matchId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.media.requireUploader(user.id, id);
    return this.highlights.hostMatchHighlights(user.id, id);
  }

  // --- AI-Cam A: to'liq o'yin yozuvi ------------------------------------------------------------------
  @Get('matches/:matchId/recording')
  recording(@Param('matchId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recordings.hostView(user.id, id);
  }

  /** Kamera faylini ro'yxatga olish: yozish boshlanganda va to'xtaganda (idempotent, offline'dan keyin ham). */
  @Put('matches/:matchId/recording/cameras/:clientCameraId')
  camera(
    @Param('matchId', ParseUUIDPipe) id: string,
    @Param('clientCameraId', ParseUUIDPipe) cameraId: string,
    @ZBody(CameraBody) body: z.infer<typeof CameraBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recordings.putCamera(user.id, id, cameraId, body);
  }

  /** Yozuv faylini yuklash (S3 multipart); davomi `GET /v1/media/{id}/upload`, yakuni `POST /v1/media/{id}/complete`. */
  @Post('matches/:matchId/recording/cameras/:clientCameraId/upload')
  @HttpCode(201)
  cameraUpload(
    @Param('matchId', ParseUUIDPipe) id: string,
    @Param('clientCameraId', ParseUUIDPipe) cameraId: string,
    @ZBody(CameraUploadBody) body: z.infer<typeof CameraUploadBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recordings.initCameraUpload(user.id, id, cameraId, body);
  }

  @Post('matches/:matchId/recording/markers')
  @HttpCode(200)
  markers(@Param('matchId', ParseUUIDPipe) id: string, @ZBody(MarkersBody) body: z.infer<typeof MarkersBody>, @CurrentUser() user: AuthUser) {
    return this.recordings.addMarkers(user.id, id, body.markers);
  }

  @Delete('matches/:matchId/recording/markers/:clientMarkerId')
  @HttpCode(204)
  async deleteMarker(
    @Param('matchId', ParseUUIDPipe) id: string,
    @Param('clientMarkerId', ParseUUIDPipe) markerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.recordings.deleteMarker(user.id, id, markerId);
  }
}

@Module({
  imports: [MediaModule],
  controllers: [HostController],
  providers: [HostService, DispatchService],
  exports: [DispatchService],
})
export class HostModule {}
