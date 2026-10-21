import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, ZBody } from '../common/http';
import { FeedbackService } from './feedback.service';
import { PostMatchConsumer, RatingsService } from './ratings.service';

const Tag = z.string().regex(/^[a-z_]{2,30}$/);

const FeedbackBody = z.object({
  items: z
    .array(
      z.object({
        target: z.enum(['host', 'player', 'match', 'venue']),
        to_user_id: z.uuid().optional(),
        rating: z.number().int().min(1).max(5),
        tags: z.array(Tag).max(5).optional(),
        comment: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
});

@Controller('v1/matches/:matchId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** Baholash ekrani: host, boshqa o'yinchilar, muddat va avval qoldirilgan baholar. */
  @Get()
  get(@Param('matchId', ParseUUIDPipe) matchId: string, @CurrentUser() user: AuthUser) {
    return this.feedback.get(user.id, matchId);
  }

  @Post()
  @HttpCode(200)
  submit(@Param('matchId', ParseUUIDPipe) matchId: string, @ZBody(FeedbackBody) body: z.infer<typeof FeedbackBody>, @CurrentUser() user: AuthUser) {
    return this.feedback.submit(user.id, matchId, body.items);
  }
}

/** Profile konteksti: Glicko-2 reyting (`MatchCompleted` consumer'i) va o'yin haqida feedback. */
@Module({
  controllers: [FeedbackController],
  providers: [RatingsService, PostMatchConsumer, FeedbackService],
  exports: [RatingsService, PostMatchConsumer],
})
export class RatingsModule {}
