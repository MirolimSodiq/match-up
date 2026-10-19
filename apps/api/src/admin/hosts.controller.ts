import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReqLocale, Roles, ZBody, ZQuery } from '../common/http';
import type { Locale } from '../common/i18n';
import { type Actor, CurrentActor } from './audit';
import { AdminHostsService } from './hosts.service';
import { Code, csv, GeoPoint, Page } from './schemas';

const Phone = z
  .string()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164 formatida bo'lishi kerak, masalan +998901234567"));

const HostProfile = z.object({
  city_id: z.number().int().positive(),
  base_location: GeoPoint.nullable().optional(),
  max_travel_km: z.number().int().min(1).max(100).optional(),
  has_kit: z.boolean().optional(),
  kit_notes: z.string().trim().max(500).nullable().optional(),
  sports: z.array(Code).min(1).max(10),
});
const HostCreate = HostProfile.extend({
  phone: Phone,
  display_name: z.string().trim().min(2).max(40).optional(),
  approve: z.boolean().optional(),
});
const HostUpdate = HostProfile.partial().refine((v) => Object.keys(v).length > 0, 'Kamida bitta maydon kerak');
const Suspend = z.object({ reason: z.string().trim().min(3).max(500) });

const HostList = z.object({
  status: csv(z.enum(['applicant', 'active', 'suspended', 'offboarded'])).optional(),
  city_id: z.coerce.number().int().positive().optional(),
  sport: Code.optional(),
  q: z.string().trim().max(100).optional(),
  ...Page,
});

@Roles('admin')
@Controller('v1/admin/hosts')
export class AdminHostsController {
  constructor(private readonly hosts: AdminHostsService) {}

  @Get()
  list(@ZQuery(HostList) q: z.infer<typeof HostList>, @ReqLocale() locale: Locale) {
    return this.hosts.list(q, locale);
  }

  @Post()
  @HttpCode(201)
  create(@ZBody(HostCreate) body: z.infer<typeof HostCreate>, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.hosts.create(actor, body, locale);
  }

  @Get(':userId')
  get(@Param('userId', ParseUUIDPipe) id: string, @ReqLocale() locale: Locale) {
    return this.hosts.get(id, locale);
  }

  @Patch(':userId')
  update(@Param('userId', ParseUUIDPipe) id: string, @ZBody(HostUpdate) body: z.infer<typeof HostUpdate>, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.hosts.update(actor, id, body, locale);
  }

  @Post(':userId/approve')
  @HttpCode(200)
  approve(@Param('userId', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.hosts.approve(actor, id, locale);
  }

  @Post(':userId/suspend')
  @HttpCode(200)
  suspend(@Param('userId', ParseUUIDPipe) id: string, @ZBody(Suspend) body: z.infer<typeof Suspend>, @CurrentActor() actor: Actor, @ReqLocale() locale: Locale) {
    return this.hosts.suspend(actor, id, body.reason, locale);
  }
}
