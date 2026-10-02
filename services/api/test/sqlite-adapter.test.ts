import { describe, expect, it } from 'vitest';
import { SqliteSchedulingAdapter } from '../src/adapters/sqlite.js';
import { schedulingAdapterContract } from './contract/scheduling-adapter.contract.js';
import { loadDemoConfig, makeTestDb, withTenant } from './helpers.js';

schedulingAdapterContract('sqlite', {
  async make() {
    const config = await loadDemoConfig();
    const { db, cleanup } = await makeTestDb([config]);
    return { adapter: new SqliteSchedulingAdapter(db, config), cleanup };
  },
});

describe('sqlite adapter: tenant isolation', () => {
  it('never returns another tenant’s patients or appointments', async () => {
    const base = await loadDemoConfig();
    const a = withTenant(base, 'clinic-a');
    const b = withTenant(base, 'clinic-b');
    const { db, cleanup } = await makeTestDb([a, b]);
    try {
      const adapterA = new SqliteSchedulingAdapter(db, a);
      const adapterB = new SqliteSchedulingAdapter(db, b);
      const patient = await adapterA.createPatient({ name: 'Pooja Malhotra', phone: '9811100733' });
      const appt = await adapterA.book({
        idempotencyKey: 'tenant-a-key-1',
        patientId: patient.id,
        resourceId: 'dr-mehta',
        serviceId: 'cleaning',
        start: '2026-10-13T10:00',
        end: '2026-10-13T10:30',
        source: 'test',
      });

      expect(await adapterB.findPatients({ phone: '9811100733' })).toEqual([]);
      expect(await adapterB.getAppointment(appt.id)).toBeNull();
      // B's schedule is unaffected by A's booking…
      const slots = await adapterB.listSlots(
        {
          serviceId: 'cleaning',
          resourceId: 'dr-mehta',
          dateFrom: '2026-10-13',
          dateTo: '2026-10-13',
          limit: 1,
        },
        '2026-10-12T09:00',
      );
      expect(slots[0]?.start).toBe('2026-10-13T10:00');
      // …and the same idempotency key in B is a different request space.
      const sameKey = await adapterB.book({
        idempotencyKey: 'tenant-a-key-1',
        patientId: (await adapterB.createPatient({ name: 'Other', phone: '9811100999' })).id,
        resourceId: 'dr-mehta',
        serviceId: 'cleaning',
        start: '2026-10-13T10:00',
        end: '2026-10-13T10:30',
        source: 'test',
      });
      expect(sameKey.id).not.toBe(appt.id);
    } finally {
      cleanup();
    }
  });
});
