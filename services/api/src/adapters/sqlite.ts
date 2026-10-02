import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gt, gte, lt, ne, or } from 'drizzle-orm';
import { type BusinessConfig, type Slot, ToolFailure } from '@myna/shared';
import { type Db, sqliteErrorText, type Tx, writeTransaction } from '../db/client.js';
import { appointments, idempotencyKeys, patients } from '../db/schema.js';
import { nameKey, phoneKey } from '../core/identity.js';
import { generateSlots, type Interval, type SlotQuery } from '../core/slots.js';
import type {
  BookRequest,
  CancelRequest,
  PatientRecord,
  RescheduleRequest,
  SchedulingAdapter,
  StoredAppointment,
} from './types.js';

const toStored = (row: typeof appointments.$inferSelect): StoredAppointment => ({
  id: row.id,
  patientId: row.patientId,
  resourceId: row.resourceId,
  serviceId: row.serviceId,
  start: row.start,
  end: row.end,
  status: row.status,
});

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** SQLite's unique-index failure, surfaced by libsql as SQLITE_CONSTRAINT. */
function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(sqliteErrorText(e));
}

export class SqliteSchedulingAdapter implements SchedulingAdapter {
  private readonly tenantId: string;

  constructor(
    private readonly db: Db,
    readonly config: BusinessConfig,
  ) {
    this.tenantId = config.tenantId;
  }

  async findPatients(by: { phone?: string; dob?: string }): Promise<PatientRecord[]> {
    const conds = [];
    const phone = by.phone === undefined ? null : phoneKey(by.phone);
    if (phone) conds.push(eq(patients.phone, phone));
    if (by.dob) conds.push(eq(patients.dob, by.dob));
    if (conds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.tenantId, this.tenantId), or(...conds)));
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, dob: r.dob }));
  }

  async createPatient(p: {
    name: string;
    phone: string;
    dob?: string | undefined;
  }): Promise<PatientRecord> {
    const phone = phoneKey(p.phone);
    if (!phone)
      throw new ToolFailure('VALIDATION', 'phone must be a 10-digit Indian mobile number');
    const row = {
      id: `pat_${randomUUID()}`,
      tenantId: this.tenantId,
      name: p.name.trim(),
      nameKey: nameKey(p.name),
      phone,
      dob: p.dob ?? null,
    };
    await this.db.insert(patients).values(row);
    return { id: row.id, name: row.name, phone: row.phone, dob: row.dob };
  }

  async listSlots(query: SlotQuery, now: string): Promise<Slot[]> {
    const rows = await this.db
      .select({
        resourceId: appointments.resourceId,
        start: appointments.start,
        end: appointments.end,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          ne(appointments.status, 'cancelled'),
          // Any appointment touching the queried days.
          gte(appointments.end, `${query.dateFrom}T00:00`),
          lt(appointments.start, `${query.dateTo}T23:59`),
        ),
      );
    const busy = new Map<string, Interval[]>();
    for (const r of rows) {
      const list = busy.get(r.resourceId) ?? [];
      list.push({ start: r.start, end: r.end });
      busy.set(r.resourceId, list);
    }
    return generateSlots(this.config, query, busy, now);
  }

  async getAppointment(id: string): Promise<StoredAppointment | null> {
    const [row] = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, this.tenantId), eq(appointments.id, id)));
    return row ? toStored(row) : null;
  }

  async listAppointments(patientId: string, from: string): Promise<StoredAppointment[]> {
    const rows = await this.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          eq(appointments.patientId, patientId),
          ne(appointments.status, 'cancelled'),
          gte(appointments.start, from),
        ),
      )
      .orderBy(appointments.start);
    return rows.map(toStored);
  }

  book(req: BookRequest): Promise<StoredAppointment> {
    return this.idempotent('book', req.idempotencyKey, req, async (tx) => {
      await this.assertFree(tx, req.resourceId, req, null);
      const row = {
        id: `apt_${randomUUID()}`,
        tenantId: this.tenantId,
        patientId: req.patientId,
        resourceId: req.resourceId,
        serviceId: req.serviceId,
        start: req.start,
        end: req.end,
        status: 'confirmed' as const,
        source: req.source,
      };
      await tx.insert(appointments).values(row);
      return toStored({ ...row, createdAt: '', updatedAt: '' });
    });
  }

  reschedule(req: RescheduleRequest): Promise<StoredAppointment> {
    return this.idempotent('reschedule', req.idempotencyKey, req, async (tx) => {
      const current = await this.ownedActive(tx, req.appointmentId, req.patientId);
      await this.assertFree(tx, req.resourceId, req, current.id);
      const updatedAt = new Date().toISOString();
      await tx
        .update(appointments)
        .set({ resourceId: req.resourceId, start: req.start, end: req.end, updatedAt })
        .where(and(eq(appointments.tenantId, this.tenantId), eq(appointments.id, current.id)));
      return { ...current, resourceId: req.resourceId, start: req.start, end: req.end };
    });
  }

  cancel(req: CancelRequest): Promise<StoredAppointment> {
    return this.idempotent('cancel', req.idempotencyKey, req, async (tx) => {
      const current = await this.ownedActive(tx, req.appointmentId, req.patientId);
      await tx
        .update(appointments)
        .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
        .where(and(eq(appointments.tenantId, this.tenantId), eq(appointments.id, current.id)));
      return { ...current, status: 'cancelled' };
    });
  }

  // ---------------------------------------------------------------- internals

  /** The patient's own, non-cancelled appointment, or a typed failure. */
  private async ownedActive(
    tx: Tx,
    appointmentId: string,
    patientId: string,
  ): Promise<StoredAppointment> {
    const [row] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          eq(appointments.id, appointmentId),
          // Someone else's appointment is indistinguishable from a missing one.
          eq(appointments.patientId, patientId),
        ),
      );
    if (!row) throw new ToolFailure('NOT_FOUND', 'no such appointment for this patient');
    if (row.status === 'cancelled')
      throw new ToolFailure('ALREADY_CANCELLED', 'appointment is already cancelled');
    return toStored(row);
  }

  private async assertFree(
    tx: Tx,
    resourceId: string,
    slot: Interval,
    ignoreId: string | null,
  ): Promise<void> {
    const clash = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          eq(appointments.resourceId, resourceId),
          ne(appointments.status, 'cancelled'),
          lt(appointments.start, slot.end),
          gt(appointments.end, slot.start),
          ...(ignoreId ? [ne(appointments.id, ignoreId)] : []),
        ),
      )
      .limit(1);
    if (clash.length > 0) throw new ToolFailure('SLOT_UNAVAILABLE', 'that time was just taken');
  }

  /**
   * Runs `work` once per idempotency key, inside one write transaction. A replay with the same
   * request returns the stored result; the same key with a different request is a conflict.
   */
  private async idempotent<T>(
    operation: string,
    key: string,
    request: unknown,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const requestHash = hash({ operation, request });
    try {
      return await writeTransaction(this.db, async (tx) => {
        const [prior] = await tx
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.tenantId, this.tenantId), eq(idempotencyKeys.key, key)));
        if (prior) {
          if (prior.requestHash !== requestHash) {
            throw new ToolFailure(
              'IDEMPOTENCY_CONFLICT',
              'idempotency key reused for a different request',
            );
          }
          return JSON.parse(prior.responseJson) as T;
        }
        const result = await work(tx);
        await tx.insert(idempotencyKeys).values({
          tenantId: this.tenantId,
          key,
          operation,
          requestHash,
          responseJson: JSON.stringify(result),
        });
        return result;
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ToolFailure('SLOT_UNAVAILABLE', 'that time was just taken');
      throw e;
    }
  }
}
