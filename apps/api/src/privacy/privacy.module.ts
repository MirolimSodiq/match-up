import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { ENV, type Env } from '../config/env';
import { MediaModule } from '../media/media.module';
import { DataExportService } from './data-export.service';
import { ErasureService } from './erasure.service';
import { MediaExport } from './media-export';
import { PrivacyController } from './privacy.controller';
import { FILE_STORAGE, LocalFileStorage } from './storage';

/** GDPR: data subject request'lar (eksport, erasure) va ularni bajaradigan job'lar. */
@Module({
  imports: [CommerceModule, MediaModule],
  controllers: [PrivacyController],
  providers: [
    DataExportService,
    ErasureService,
    MediaExport,
    { provide: FILE_STORAGE, inject: [ENV], useFactory: (env: Env) => new LocalFileStorage(env.STORAGE_DIR) },
  ],
  exports: [DataExportService, ErasureService],
})
export class PrivacyModule {}
