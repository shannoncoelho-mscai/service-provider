import { CheckCircle2, Clock, Ban, XCircle, PlayCircle, Check } from 'lucide-react';
import { STATUS_LABEL } from '../../lib/booking-utils';
import type { BookingStatus } from '../../types';

/**
 * Status pill.
 *
 * Accessibility: status is carried by an ICON and a TEXT label, never by colour
 * alone (WCAG 1.4.1). The colours are the existing brand tokens so a booking
 * badge looks native to the rest of the product.
 */
const STYLES: Record<BookingStatus, { className: string; Icon: typeof Clock }> = {
  PENDING: { className: 'bg-accent-50 text-accent-600 border-accent-100', Icon: Clock },
  ACCEPTED: { className: 'bg-brand-50 text-brand-700 border-brand-100', Icon: CheckCircle2 },
  IN_PROGRESS: { className: 'bg-brand-50 text-brand-800 border-brand-200', Icon: PlayCircle },
  COMPLETED: { className: 'bg-emerald-50 text-emerald-700 border-emerald-100', Icon: Check },
  REJECTED: { className: 'bg-red-50 text-red-700 border-red-100', Icon: Ban },
  CANCELLED: { className: 'bg-slate-100 text-slate-600 border-slate-200', Icon: XCircle },
};

export default function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { className, Icon } = STYLES[status] ?? STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
