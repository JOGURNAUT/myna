import { createHash, randomUUID } from 'node:crypto';
import { type AppointmentStatus, type BusinessConfig, type Slot, ToolFailure } from '@myna/shared';
import { phoneKey } from '../../core/identity.js';
import { generateSlots, type Interval, type SlotQuery } from '../../core/slots.js';
import type {
  BookRequest,
  CancelRequest,
  PatientRecord,
  RescheduleRequest,
  SchedulingAdapter,
  StoredAppointment,
} from '../types.js';
import type { SheetsClient } from './client.js';
import { InProcessMutex, type Mutex } from './mutex.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const STATUSES: readonly string[] = ['confirmed', 'pending', 'cancelled'];

/**
 * The schedule lives in a Google Sheet the clinic already understands: three tabs (Patients,
 * Appointments, Idempotency). Staff can read it, and edit it by hand; rows we can't parse are
 * skipped rather than trusted.
 *
 * Sheets has no transactions, so every write runs under a mutex and re-reads the sheet first;
 * "no overlapping bookings" and "an idempotent retry books once" hold for everything that goes
 * through this adapter. (A person typing a booking into the same slot at the same instant is
 * outside what any spreadsheet can promise; the next booking attempt sees their row and refuses.)
 */
export class SheetsSchedulingAdapter implements SchedulingAdapter {
  constructor(
    private readonly sheets: SheetsClient,
    readonly config: BusinessConfig,
    private readonly mutex: Mutex = new InProcessMutex(),
  ) {}

  // ---------------------------------------------------------------- rows <-> records

  private async patients(): Promise<{ index: number; record: PatientRecord }[]> {
    const rows = await this.sheets.readRows('Patients');
    return rows.flatMap((r, index) => {
      const [id, name, phone, dob] = r;
      if (!id || !name) return [];
      const key = phoneKey(phone ?? '');
      return [{ index, record: { id, name, phone: key ?? '', dob: dob || null } }];
    });
  }

  private async appointments(): Promise<{ index: number; appt: StoredAppointment }[]> {
    const rows = await this.sheets.readRows('Appointments');
    return rows.flatMap((r, index) => {
      const [id, patientId, resourceId, serviceId, start, end, status] = r;
      if (!id || !patientId || !resourceId || !serviceId || !start || !end) return [];
      if (!status || !STATUSES.includes(status)) return [];
      return [
        {
          index,
          appt: {
            id,
            patientId,
            resourceId,
            serviceId,
            start,
            end,
            status: status as AppointmentStatus,
          },
        },
      ];
    });
  }

  private toRow(a: StoredAppointment, source: string): string[] {
    return [
      a.id,
      a.patientId,
      a.resourceId,
      a.serviceId,
      a.start,
      a.end,
      a.status,
      source,
      new Date().toISOString(),
    ];
  }

  // ---------------------------------------------------------------- patients

  async findPatients(by: { phone?: string; dob?: string }): Promise<PatientRecord[]> {
    const phone = by.phone === undefined ? null : phoneKey(by.phone);
    if (!phone && !by.dob) return [];
    const all = await this.patients();
    return all
      .map((p) => p.record)
      .filter((p) => (phone !== null && p.phone === phone) || (by.dob && p.dob === by.dob));
  }

  async createPatient(p: {
    name: string;
    phone: string;
    dob?: string | undefined;
  }): Promise<PatientRecord> {
    const phone = phoneKey(p.phone);
    if (!phone)
      throw new ToolFailure('VALIDATION', 'phone must be a 10-digit Indian mobile number');
    const record: PatientRecord = {
      id: `pat_${randomUUID()}`,
      name: p.name.trim(),
      phone,
      dob: p.dob ?? null,
    };
    await this.sheets.appendRow('Patients', [
      record.id,
      record.name,
      record.phone,
      record.dob ?? '',
    ]);
    return record;
  }

  async getPatient(id: string): Promise<PatientRecord | null> {
    return (await this.patients()).find((p) => p.record.id === id)?.record ?? null;
  }

  // ---------------------------------------------------------------- reads

  async listSlots(query: SlotQuery, now: string): Promise<Slot[]> {
    const busy = new Map<string, Interval[]>();
    for (const { appt } of await this.appointments()) {
      if (appt.status === 'cancelled') continue;
      if (appt.end < `${query.dateFrom}T00:00` || appt.start >= `${query.dateTo}T23:59`) continue;
      const list = busy.get(appt.resourceId) ?? [];
      list.push({ start: appt.start, end: appt.end });
      busy.set(appt.resourceId, list);
    }
    return generateSlots(this.config, query, busy, now);
  }

  async getAppointment(id: string): Promise<StoredAppointment | null> {
    return (await this.appointments()).find((a) => a.appt.id === id)?.appt ?? null;
  }

  async listAppointments(patientId: string, from: string): Promise<StoredAppointment[]> {
    return (await this.appointments())
      .map((a) => a.appt)
      .filter((a) => a.patientId === patientId && a.status !== 'cancelled' && a.start >= from)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async listAppointmentsBetween(from: string, to: string): Promise<StoredAppointment[]> {
    return (await this.appointments())
      .map((a) => a.appt)
      .filter((a) => a.status !== 'cancelled' && a.start >= from && a.start < to)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---------------------------------------------------------------- writes

  book(req: BookRequest): Promise<StoredAppointment> {
    return this.idempotent('book', req.idempotencyKey, req, async () => {
      await this.assertFree(req.resourceId, req, null);
      const appt: StoredAppointment = {
        id: `apt_${randomUUID()}`,
        patientId: req.patientId,
        resourceId: req.resourceId,
        serviceId: req.serviceId,
        start: req.start,
        end: req.end,
        status: req.status ?? 'confirmed',
      };
      await this.sheets.appendRow('Appointments', this.toRow(appt, req.source));
      return appt;
    });
  }

  reschedule(req: RescheduleRequest): Promise<StoredAppointment> {
    return this.idempotent('reschedule', req.idempotencyKey, req, async () => {
      const { index, appt } = await this.ownedActive(req.appointmentId, req.patientId);
      await this.assertFree(req.resourceId, req, appt.id);
      const moved: StoredAppointment = {
        ...appt,
        resourceId: req.resourceId,
        start: req.start,
        end: req.end,
      };
      await this.sheets.updateRow('Appointments', index, this.toRow(moved, 'agent'));
      return moved;
    });
  }

  cancel(req: CancelRequest): Promise<StoredAppointment> {
    return this.idempotent('cancel', req.idempotencyKey, req, async () => {
      const { index, appt } = await this.ownedActive(req.appointmentId, req.patientId);
      const cancelled: StoredAppointment = { ...appt, status: 'cancelled' };
      await this.sheets.updateRow('Appointments', index, this.toRow(cancelled, 'agent'));
      return cancelled;
    });
  }

  decidePending(
    appointmentId: string,
    decision: 'confirmed' | 'cancelled',
  ): Promise<StoredAppointment> {
    return this.mutex.run(async () => {
      const found = (await this.appointments()).find((a) => a.appt.id === appointmentId);
      if (!found) throw new ToolFailure('NOT_FOUND', 'no such appointment');
      if (found.appt.status !== 'pending') {
        throw new ToolFailure('VALIDATION', `appointment is ${found.appt.status}, not pending`);
      }
      const decided: StoredAppointment = { ...found.appt, status: decision };
      await this.sheets.updateRow('Appointments', found.index, this.toRow(decided, 'staff'));
      return decided;
    });
  }

  // ---------------------------------------------------------------- internals

  private async ownedActive(
    appointmentId: string,
    patientId: string,
  ): Promise<{ index: number; appt: StoredAppointment }> {
    const found = (await this.appointments()).find(
      // Someone else's appointment is indistinguishable from a missing one.
      (a) => a.appt.id === appointmentId && a.appt.patientId === patientId,
    );
    if (!found) throw new ToolFailure('NOT_FOUND', 'no such appointment for this patient');
    if (found.appt.status === 'cancelled') {
      throw new ToolFailure('ALREADY_CANCELLED', 'appointment is already cancelled');
    }
    return found;
  }

  private async assertFree(
    resourceId: string,
    slot: Interval,
    ignoreId: string | null,
  ): Promise<void> {
    const clash = (await this.appointments()).some(
      ({ appt }) =>
        appt.resourceId === resourceId &&
        appt.status !== 'cancelled' &&
        appt.id !== ignoreId &&
        appt.start < slot.end &&
        appt.end > slot.start,
    );
    if (clash) throw new ToolFailure('SLOT_UNAVAILABLE', 'that time was just taken');
  }

  /**
   * Once per idempotency key, under the mutex. A replay with the same request returns the stored
   * result; the same key with a different request is a conflict.
   */
  private idempotent<T>(
    operation: string,
    key: string,
    request: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const requestHash = hash({ operation, request });
    return this.mutex.run(async () => {
      const prior = (await this.sheets.readRows('Idempotency')).find((r) => r[0] === key);
      if (prior) {
        if (prior[2] !== requestHash) {
          throw new ToolFailure(
            'IDEMPOTENCY_CONFLICT',
            'idempotency key reused for a different request',
          );
        }
        return JSON.parse(prior[3] ?? 'null') as T;
      }
      const result = await work();
      await this.sheets.appendRow('Idempotency', [
        key,
        operation,
        requestHash,
        JSON.stringify(result),
      ]);
      return result;
    });
  }
}
