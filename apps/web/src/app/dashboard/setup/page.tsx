import { Badge, Card } from '@/components/ui';
import { staffApi } from '@/lib/api';
import type { Hours, Setup } from '@/lib/types';

export const metadata = { title: 'Setup' };

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
] as const;

const MODE: Record<Setup['schedulingMode'], string> = {
  slots: 'Appointment slots',
  tokens: 'Token queue',
  hybrid: 'Both',
};

function hoursText(h: Hours, d: (typeof DAYS)[number][0]): string {
  const spans = h[d] ?? [];
  return spans.length ? spans.map((s) => `${s.start} – ${s.end}`).join(', ') : 'Closed';
}

export default async function SetupPage() {
  const s = await staffApi<Setup>('/setup');
  return (
    <section aria-labelledby="su" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="su" className="text-2xl font-bold">
          Clinic setup
        </h1>
        <p className="max-w-2xl text-ink-2">
          This is what Myna was set up to do for {s.name}. It is read-only here on purpose: changes
          go through your Myna contact, so a typo can never quietly change what she tells patients.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">How patients get seen</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">{MODE[s.schedulingMode]}</Badge>
            <Badge tone="muted">
              Schedule kept in{' '}
              {s.scheduleStore === 'gsheets' ? 'Google Sheets' : 'Myna’s own store'}
            </Badge>
            <Badge tone={s.bookingApproval === 'after_hours' ? 'warn' : 'muted'}>
              {s.bookingApproval === 'after_hours'
                ? 'After-hours bookings wait for your approval'
                : 'Bookings are confirmed at once'}
            </Badge>
          </div>
          <p className="text-sm text-ink-2">
            Slots every {s.booking.slotStepMin} minutes, at least {s.booking.minNoticeMin} minutes
            ahead, up to {s.booking.maxDaysAhead} days out.
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">Clinic hours</h2>
          <dl className="tnum grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 text-sm">
            {DAYS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt className="font-semibold">{label}</dt>
                <dd className="text-ink-2">{hoursText(s.hours, k)}</dd>
              </div>
            ))}
          </dl>
          {s.closedDates.length > 0 && (
            <p className="text-sm text-ink-3">Closed on {s.closedDates.join(', ')}.</p>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">Doctors</h2>
          <ul className="flex flex-col gap-2">
            {s.resources.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5">
                <b>{r.name}</b>
                <span className="text-sm text-ink-2">
                  {r.services
                    .map((id) => s.services.find((x) => x.id === id)?.name ?? id)
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-bold">Visit types</h2>
          <ul className="tnum flex flex-col gap-1.5">
            {s.services.map((v) => (
              <li key={v.id} className="flex justify-between gap-4">
                <span>{v.name}</span>
                <span className="text-ink-2">{v.durationMin} min</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="font-bold">Answers Myna may give</h2>
          <p className="text-sm text-ink-2">
            Anything not listed here, Myna does not guess: she takes a message and promises a staff
            call within {s.callbackPromiseHours} opening hours.
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {s.faq.map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 py-2.5">
                <b>{f.question}</b>
                {f.answer ? (
                  <span className="text-ink-2">{f.answer}</span>
                ) : (
                  <span className="text-ink-3 italic">
                    Left blank on purpose: Myna takes a message.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-2 lg:col-span-2">
          <h2 className="font-bold">Calls and privacy</h2>
          <p className="text-sm text-ink-2">
            Front desk: {s.phone} · Calls pass to {s.humanHandoffNumber} on handoff or when the kill
            switch is on. Languages: {s.languages.join(', ')}. Calls are{' '}
            {s.recordCalls ? 'recorded (and the caller is told)' : 'not recorded'}.
          </p>
        </Card>
      </div>
    </section>
  );
}
