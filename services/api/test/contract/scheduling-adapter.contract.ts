import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isToolFailure } from '@myna/shared';
import type { BookRequest, SchedulingAdapter } from '../../src/adapters/types.js';

/**
 * The contract every SchedulingAdapter must pass. Same tests, different backends:
 * the SQLite adapter runs it now; the Google Sheets adapter must run it in M4.
 *
 * The factory gets the demo clinic config and must return an EMPTY store.
 */
export interface AdapterFactory {
  make: () => Promise<{ adapter: SchedulingAdapter; cleanup: () => void | Promise<void> }>;
}

const NOW = '2026-10-12T09:00';
let keyN = 0;
const key = () => `contract-key-${++keyN}-${Date.now()}`;

async function failureCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (isToolFailure(e)) return e.code;
    throw e;
  }
}

export function schedulingAdapterContract(name: string, factory: AdapterFactory): void {
  describe(`SchedulingAdapter contract: ${name}`, () => {
    let adapter: SchedulingAdapter;
    let cleanup: () => void | Promise<void>;
    let pooja: string;
    let arjun: string;

    const bookReq = (over: Partial<BookRequest> = {}): BookRequest => ({
      idempotencyKey: key(),
      patientId: pooja,
      resourceId: 'dr-mehta',
      serviceId: 'cleaning',
      start: '2026-10-13T10:00',
      end: '2026-10-13T10:30',
      source: 'test',
      ...over,
    });

    beforeEach(async () => {
      ({ adapter, cleanup } = await factory.make());
      pooja = (
        await adapter.createPatient({
          name: 'Pooja Malhotra',
          phone: '9811100733',
          dob: '1990-04-12',
        })
      ).id;
      arjun = (await adapter.createPatient({ name: 'Arjun Verma', phone: '+91 99111 00487' })).id;
    });
    afterEach(async () => {
      await cleanup();
    });

    describe('patients', () => {
      it('finds candidates by phone (normalised) and by date of birth', async () => {
        const byPhone = await adapter.findPatients({ phone: '99111 00487' });
        expect(byPhone.map((p) => p.id)).toEqual([arjun]);
        expect(byPhone[0]?.phone).toBe('9911100487');
        const byDob = await adapter.findPatients({ dob: '1990-04-12' });
        expect(byDob.map((p) => p.id)).toEqual([pooja]);
      });

      it('gets a patient by id, and nothing for an unknown id', async () => {
        expect(await adapter.getPatient(pooja)).toMatchObject({
          name: 'Pooja Malhotra',
          phone: '9811100733',
        });
        expect(await adapter.getPatient('pat_nope')).toBeNull();
      });

      it('returns nothing without a phone or dob', async () => {
        expect(await adapter.findPatients({})).toEqual([]);
      });
    });

    describe('book', () => {
      it('books, lists and removes the slot from availability', async () => {
        const appt = await adapter.book(bookReq());
        expect(appt).toMatchObject({
          patientId: pooja,
          status: 'confirmed',
          start: '2026-10-13T10:00',
        });
        expect(await adapter.getAppointment(appt.id)).toEqual(appt);
        expect((await adapter.listAppointments(pooja, NOW)).map((a) => a.id)).toEqual([appt.id]);
        const slots = await adapter.listSlots(
          {
            serviceId: 'cleaning',
            resourceId: 'dr-mehta',
            dateFrom: '2026-10-13',
            dateTo: '2026-10-13',
            limit: 3,
          },
          NOW,
        );
        expect(slots.map((s) => s.start)).toEqual([
          '2026-10-13T10:30',
          '2026-10-13T10:45',
          '2026-10-13T11:00',
        ]);
      });

      it('refuses any overlap on the same resource', async () => {
        await adapter.book(bookReq());
        const overlap = adapter.book(
          bookReq({
            patientId: arjun,
            serviceId: 'consultation',
            start: '2026-10-13T10:15',
            end: '2026-10-13T10:30',
          }),
        );
        expect(await failureCode(overlap)).toBe('SLOT_UNAVAILABLE');
      });

      it('allows the same time with a different resource', async () => {
        await adapter.book(bookReq());
        const other = await adapter.book(bookReq({ patientId: arjun, resourceId: 'dr-rao' }));
        expect(other.status).toBe('confirmed');
      });

      it('replays an idempotent retry instead of booking twice', async () => {
        const req = bookReq();
        const first = await adapter.book(req);
        const retry = await adapter.book(req);
        expect(retry).toEqual(first);
        expect(await adapter.listAppointments(pooja, NOW)).toHaveLength(1);
      });

      it('rejects a reused key with a different request', async () => {
        const req = bookReq();
        await adapter.book(req);
        const reused = adapter.book({ ...req, start: '2026-10-13T11:00', end: '2026-10-13T11:30' });
        expect(await failureCode(reused)).toBe('IDEMPOTENCY_CONFLICT');
      });

      it('lets exactly one of several concurrent bookings for a slot win', async () => {
        const results = await Promise.allSettled(
          [pooja, arjun, pooja, arjun, pooja].map((patientId) =>
            adapter.book(bookReq({ patientId })),
          ),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const r of results) {
          if (r.status === 'rejected')
            expect(isToolFailure(r.reason) && r.reason.code).toBe('SLOT_UNAVAILABLE');
        }
      });
    });

    describe('listAppointmentsBetween', () => {
      it("lists every patient's non-cancelled appointments in a half-open range", async () => {
        const a = await adapter.book(bookReq());
        const b = await adapter.book(
          bookReq({ patientId: arjun, start: '2026-10-13T17:00', end: '2026-10-13T17:30' }),
        );
        await adapter.book(
          bookReq({ start: '2026-10-14T10:00', end: '2026-10-14T10:30', resourceId: 'dr-rao' }),
        );
        const c = await adapter.book(
          bookReq({ patientId: arjun, start: '2026-10-13T11:00', end: '2026-10-13T11:30' }),
        );
        await adapter.cancel({ idempotencyKey: key(), appointmentId: c.id, patientId: arjun });
        const day = await adapter.listAppointmentsBetween('2026-10-13T00:00', '2026-10-14T00:00');
        expect(day.map((x) => x.id)).toEqual([a.id, b.id]);
      });
    });

    describe('reschedule', () => {
      it('moves the appointment and frees the old slot, leaving exactly one booking', async () => {
        const appt = await adapter.book(bookReq());
        const moved = await adapter.reschedule({
          idempotencyKey: key(),
          appointmentId: appt.id,
          patientId: pooja,
          resourceId: 'dr-mehta',
          start: '2026-10-15T11:00',
          end: '2026-10-15T11:30',
        });
        expect(moved).toMatchObject({
          id: appt.id,
          start: '2026-10-15T11:00',
          status: 'confirmed',
        });
        const mine = await adapter.listAppointments(pooja, NOW);
        expect(mine).toHaveLength(1);
        expect(mine[0]?.start).toBe('2026-10-15T11:00');
        const freed = await adapter.book(bookReq({ patientId: arjun }));
        expect(freed.start).toBe('2026-10-13T10:00');
      });

      it('can move within its own time (overlapping itself is fine)', async () => {
        const appt = await adapter.book(bookReq());
        const moved = await adapter.reschedule({
          idempotencyKey: key(),
          appointmentId: appt.id,
          patientId: pooja,
          resourceId: 'dr-mehta',
          start: '2026-10-13T10:15',
          end: '2026-10-13T10:45',
        });
        expect(moved.start).toBe('2026-10-13T10:15');
      });

      it('refuses to move onto another booking and leaves the original untouched', async () => {
        const mine = await adapter.book(bookReq());
        await adapter.book(
          bookReq({ patientId: arjun, start: '2026-10-13T11:00', end: '2026-10-13T11:30' }),
        );
        const clash = adapter.reschedule({
          idempotencyKey: key(),
          appointmentId: mine.id,
          patientId: pooja,
          resourceId: 'dr-mehta',
          start: '2026-10-13T11:00',
          end: '2026-10-13T11:30',
        });
        expect(await failureCode(clash)).toBe('SLOT_UNAVAILABLE');
        expect((await adapter.getAppointment(mine.id))?.start).toBe('2026-10-13T10:00');
      });

      it("treats someone else's appointment as not found", async () => {
        const appt = await adapter.book(bookReq());
        const steal = adapter.reschedule({
          idempotencyKey: key(),
          appointmentId: appt.id,
          patientId: arjun,
          resourceId: 'dr-mehta',
          start: '2026-10-15T11:00',
          end: '2026-10-15T11:30',
        });
        expect(await failureCode(steal)).toBe('NOT_FOUND');
      });
    });

    describe('cancel', () => {
      it('cancels, hides it from the patient and frees the slot', async () => {
        const appt = await adapter.book(bookReq());
        const cancelled = await adapter.cancel({
          idempotencyKey: key(),
          appointmentId: appt.id,
          patientId: pooja,
        });
        expect(cancelled.status).toBe('cancelled');
        expect(await adapter.listAppointments(pooja, NOW)).toEqual([]);
        expect((await adapter.book(bookReq({ patientId: arjun }))).status).toBe('confirmed');
      });

      it('replays a retried cancel but refuses a second, different cancel', async () => {
        const appt = await adapter.book(bookReq());
        const req = { idempotencyKey: key(), appointmentId: appt.id, patientId: pooja };
        await adapter.cancel(req);
        expect((await adapter.cancel(req)).status).toBe('cancelled');
        expect(await failureCode(adapter.cancel({ ...req, idempotencyKey: key() }))).toBe(
          'ALREADY_CANCELLED',
        );
      });

      it("refuses to cancel someone else's appointment", async () => {
        const appt = await adapter.book(bookReq());
        const code = await failureCode(
          adapter.cancel({ idempotencyKey: key(), appointmentId: appt.id, patientId: arjun }),
        );
        expect(code).toBe('NOT_FOUND');
        expect((await adapter.getAppointment(appt.id))?.status).toBe('confirmed');
      });
    });
  });
}
