import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { Roles, ZBody, ZQuery } from '../common/http';
import { type Actor, CurrentActor } from './audit';
import { AdminHighlightsService, REJECT_REASONS } from './highlights.service';
import { csv, Page } from './schemas';

const Status = z.enum(['pending', 'approved', 'rejected']);

const HighlightList = z.object({
  status: csv(Status).default(['pending']),
  match_id: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  ...Page,
});

const Moderate = z
  .object({
    status: Status.exclude(['pending']),
    reason: z.enum(REJECT_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.status !== 'rejected' || b.reason, { path: ['reason'], message: 'rad etishda sabab kerak' });

@Roles('admin')
@Controller('v1/admin/highlights')
export class AdminHighlightsController {
  constructor(private readonly highlights: AdminHighlightsService) {}

  @Get()
  list(@ZQuery(HighlightList) q: z.infer<typeof HighlightList>) {
    return this.highlights.list(q);
  }

  @Get(':highlightId')
  get(@Param('highlightId', ParseUUIDPipe) id: string) {
    return this.highlights.get(id);
  }

  @Post(':highlightId/moderate')
  @HttpCode(200)
  moderate(@Param('highlightId', ParseUUIDPipe) id: string, @ZBody(Moderate) body: z.infer<typeof Moderate>, @CurrentActor() actor: Actor) {
    return this.highlights.moderate(actor, id, body);
  }
}
