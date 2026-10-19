'use client';

import Link from 'next/link';
import { IconChevronLeft } from '@/components/icons';
import { PageHeader } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { VenueForm } from '../venue-form';

export default function NewVenuePage() {
  const { m } = useI18n();
  return (
    <>
      <PageHeader
        back={
          <Link href="/venues" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text">
            <IconChevronLeft /> {m.venues.title}
          </Link>
        }
        title={m.venues.create}
      />
      <div className="max-w-4xl">
        <VenueForm />
      </div>
    </>
  );
}
