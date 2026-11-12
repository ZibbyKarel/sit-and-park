import type { EmployeeSyncRow, EmployeeSyncSummary } from '@garage/contract';
import { employeeSyncSummarySchema } from '@garage/contract';
import type { EmployeeSyncPlan, SyncProfile } from './employee-sync-plan';
import { fitSummary, isManualAccount, planEmployeeSync } from './employee-sync-plan';

let nextId = 0;
function profile(overrides: Partial<SyncProfile> = {}): SyncProfile {
  nextId += 1;
  return {
    id: `u${nextId}`,
    email: `person${nextId}@team.blue`,
    name: `Person ${nextId}`,
    hibobId: `hb${nextId}`,
    active: true,
    manualAccount: false,
    role: 'USER',
    deactivatedBySync: false,
    ...overrides,
  };
}

function rowOf(p: SyncProfile): EmployeeSyncRow {
  return { id: p.hibobId ?? 'none', email: p.email, name: p.name };
}

function ok(plan: EmployeeSyncPlan): Extract<EmployeeSyncPlan, { status: 'OK' }> {
  if (plan.status !== 'OK') {
    throw new Error(`expected OK, got ${plan.reason}`);
  }
  return plan;
}

describe('isManualAccount', () => {
  it('treats the flag and any address outside @team.blue as manual', () => {
    expect(isManualAccount({ email: 'a@team.blue', manualAccount: false })).toBe(false);
    expect(isManualAccount({ email: 'A@TEAM.BLUE ', manualAccount: false })).toBe(false);
    expect(isManualAccount({ email: 'a@team.blue', manualAccount: true })).toBe(true);
    expect(isManualAccount({ email: 'a@example.com', manualAccount: false })).toBe(true);
    expect(isManualAccount({ email: 'a@team.blue.evil.com', manualAccount: false })).toBe(true);
  });
});

describe('planEmployeeSync', () => {
  describe('rejects the whole list', () => {
    it('when it is empty', () => {
      const plan = planEmployeeSync([], [profile()]);
      expect(plan).toMatchObject({ status: 'REJECTED', code: 'EMPTY_LIST', activeBefore: 1 });
    });

    it.each<[string, EmployeeSyncRow[], RegExp]>([
      ['a missing id', [{ email: 'a@team.blue', name: 'A' }], /row 1: missing HiBob id/],
      ['a blank id', [{ id: '  ', email: 'a@team.blue', name: 'A' }], /row 1: missing HiBob id/],
      ['a missing name', [{ id: '1', email: 'a@team.blue' }], /row 1: missing name/],
      [
        'an invalid e-mail',
        [{ id: '1', email: 'not-an-email', name: 'A' }],
        /row 1: invalid e-mail/,
      ],
      [
        'an id over 100 characters',
        [{ id: 'x'.repeat(101), email: 'a@team.blue', name: 'A' }],
        /row 1: HiBob id longer/,
      ],
      [
        'a name over 200 characters',
        [{ id: '1', email: 'a@team.blue', name: 'x'.repeat(201) }],
        /row 1: name longer/,
      ],
      [
        'a duplicate id',
        [
          { id: '1', email: 'a@team.blue', name: 'A' },
          { id: '1', email: 'b@team.blue', name: 'B' },
        ],
        /row 2: duplicate HiBob id 1/,
      ],
      [
        'a duplicate e-mail, compared trimmed and lower-cased',
        [
          { id: '1', email: 'a@team.blue', name: 'A' },
          { id: '2', email: ' A@Team.Blue ', name: 'B' },
        ],
        /row 2: duplicate e-mail a@team.blue/,
      ],
    ])('when a row has %s', (_label, rows, reason) => {
      const plan = planEmployeeSync(rows, []);
      expect(plan.status).toBe('REJECTED');
      expect(plan).toMatchObject({ code: 'INVALID_ROWS', received: rows.length });
      expect(plan.status === 'REJECTED' && plan.reason).toMatch(/^INVALID_ROWS: /);
      expect(plan.status === 'REJECTED' && plan.reason).toMatch(reason);
    });

    it('names at most five bad rows and counts the rest', () => {
      const rows = Array.from({ length: 8 }, (_, i) => ({
        id: '',
        email: `x${i}@team.blue`,
        name: 'X',
      }));
      const plan = planEmployeeSync(rows, []);
      expect(plan.status === 'REJECTED' && plan.reason).toMatch(
        /row 5: missing HiBob id and \d+ more\.$/
      );
      expect(plan.status === 'REJECTED' && plan.reason).not.toMatch(/row 6:/);
    });

    it('when the list is shorter than 90 % of the active synced users', () => {
      const profiles = Array.from({ length: 10 }, () => profile());
      // ceil(10 * 0.9) = 9; eight rows is too few.
      const plan = planEmployeeSync(profiles.slice(0, 8).map(rowOf), profiles);
      expect(plan).toMatchObject({ status: 'REJECTED', code: 'LIST_SHRANK', activeBefore: 10 });
      expect(plan.status === 'REJECTED' && plan.reason).toContain('minimum 9');
    });

    it('when a long enough list matches nobody (judged on the outcome, not the row count)', () => {
      const profiles = Array.from({ length: 10 }, () => profile());
      const strangers = Array.from({ length: 10 }, (_, i) => ({
        id: `stranger-${i}`,
        email: `stranger${i}@team.blue`,
        name: `Stranger ${i}`,
      }));
      const plan = planEmployeeSync(strangers, profiles);
      expect(plan).toMatchObject({ status: 'REJECTED', code: 'LIST_SHRANK', received: 10 });
    });

    it('validates before it checks the shrink', () => {
      const profiles = Array.from({ length: 10 }, () => profile());
      const plan = planEmployeeSync([{ id: '', email: 'x@team.blue', name: 'X' }], profiles);
      expect(plan).toMatchObject({ status: 'REJECTED', code: 'INVALID_ROWS' });
    });
  });

  it('accepts exactly 90 %, deactivating the missing one', () => {
    const profiles = Array.from({ length: 10 }, () => profile());
    const plan = ok(planEmployeeSync(profiles.slice(0, 9).map(rowOf), profiles));
    expect(plan.deactivate.map((p) => p.id)).toEqual([profiles[9]?.id]);
    expect(plan.unchanged).toBe(9);
  });

  it('counts neither manual nor inactive users towards the shrink minimum', () => {
    const active = profile();
    const profiles = [
      active,
      profile({ manualAccount: true }),
      profile({ email: 'guest@example.com' }),
      profile({ active: false }),
    ];
    const plan = ok(planEmployeeSync([rowOf(active)], profiles));
    expect(plan.activeBefore).toBe(1);
    expect(plan.deactivate).toEqual([]);
  });

  it('never touches a manual or non-company account, matched or not', () => {
    const manual = profile({ manualAccount: true, name: 'Old' });
    const external = profile({ email: 'ext@example.com', hibobId: null, active: false });
    const kept = profile();
    const plan = ok(
      planEmployeeSync(
        [
          { id: manual.hibobId ?? '', email: manual.email, name: 'New' },
          { id: 'hb-ext', email: external.email, name: 'Renamed' },
          rowOf(kept),
        ],
        [manual, external, kept, profile({ email: 'missing@example.com' })]
      )
    );
    expect(plan.update).toEqual([]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.unchanged).toBe(3);
  });

  it('cleans rows: trims, lower-cases the e-mail', () => {
    const p = profile({ email: 'ann@team.blue', name: 'Ann' });
    const plan = ok(
      planEmployeeSync([{ id: ` ${p.hibobId} `, email: ' ANN@team.blue ', name: ' Ann ' }], [p])
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.warnings).toEqual([]);
  });

  it('creates rows nobody matches', () => {
    const plan = ok(planEmployeeSync([{ id: 'new', email: 'New@team.blue', name: 'New' }], []));
    expect(plan.create).toEqual([{ hibobId: 'new', email: 'new@team.blue', name: 'New' }]);
  });

  it('links by e-mail when the user has no HiBob id yet', () => {
    const p = profile({ hibobId: null });
    const plan = ok(planEmployeeSync([{ id: 'hb-9', email: p.email, name: p.name }], [p]));
    expect(plan.update).toEqual([
      { userId: p.id, email: p.email, name: p.name, linkHibobId: 'hb-9' },
    ]);
  });

  it('renames and reactivates, matched by HiBob id', () => {
    const p = profile({ name: 'Old Name', active: false, deactivatedBySync: true });
    const plan = ok(planEmployeeSync([{ ...rowOf(p), name: 'New Name' }], [p]));
    expect(plan.update).toEqual([
      {
        userId: p.id,
        email: p.email,
        name: 'Old Name',
        rename: { from: 'Old Name', to: 'New Name' },
        reactivate: true,
      },
    ]);
  });

  it('never changes an e-mail: a different one is a warning, the other changes still apply', () => {
    const p = profile({ name: 'Old' });
    const plan = ok(
      planEmployeeSync([{ id: p.hibobId ?? '', email: 'renamed@team.blue', name: 'New' }], [p])
    );
    expect(plan.update).toEqual([
      { userId: p.id, email: p.email, name: 'Old', rename: { from: 'Old', to: 'New' } },
    ]);
    expect(plan.warnings).toEqual([expect.stringContaining('e-mail is not changed')]);
    expect(plan.deactivate).toEqual([]);
  });

  it('warns and skips when the id belongs to one user and the e-mail to another', () => {
    const a = profile();
    const b = profile();
    const plan = ok(
      planEmployeeSync(
        [
          { id: a.hibobId ?? '', email: b.email, name: 'Whoever' },
          { id: 'pad', email: 'pad@team.blue', name: 'Pad' },
        ],
        [a, b]
      )
    );
    expect(plan.update).toEqual([]);
    expect(plan.create.map((row) => row.hibobId)).toEqual(['pad']);
    // Both are seen, so neither is deactivated.
    expect(plan.deactivate).toEqual([]);
    expect(plan.warnings).toEqual([expect.stringContaining('resolve by hand')]);
  });

  it('warns and skips when the e-mail matches a user with a different HiBob id', () => {
    const p = profile({ name: 'Old' });
    const plan = ok(planEmployeeSync([{ id: 'other-id', email: p.email, name: 'New' }], [p]));
    expect(plan.update).toEqual([]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.warnings).toEqual([expect.stringContaining(`has HiBob id ${p.hibobId}`)]);
  });

  it('deactivates active synced users missing from the list, and only them', () => {
    const kept = Array.from({ length: 9 }, () => profile());
    const gone = profile();
    const alreadyInactive = profile({ active: false });
    const manual = profile({ manualAccount: true });
    const plan = ok(planEmployeeSync(kept.map(rowOf), [...kept, gone, alreadyInactive, manual]));
    expect(plan.deactivate.map((p) => p.id)).toEqual([gone.id]);
  });

  it('does not reactivate a user an admin deactivated, or one with no audit trail', () => {
    const byAdmin = profile({ active: false, deactivatedBySync: false, name: 'Old' });
    const plan = ok(planEmployeeSync([{ ...rowOf(byAdmin), name: 'New' }], [byAdmin]));
    expect(plan.update).toEqual([
      { userId: byAdmin.id, email: byAdmin.email, name: 'Old', rename: { from: 'Old', to: 'New' } },
    ]);
    expect(plan.warnings).toEqual([expect.stringContaining('not reactivated')]);
  });

  it('never deactivates the last active admin, but other missing admins go', () => {
    const kept = Array.from({ length: 18 }, () => profile());
    const admins = [profile({ role: 'ADMIN' }), profile({ role: 'ADMIN' })];
    const plan = ok(planEmployeeSync(kept.map(rowOf), [...kept, ...admins]));
    expect(plan.deactivate.map((p) => p.id)).toEqual([admins[0]?.id]);
    expect(plan.warnings).toEqual([
      expect.stringContaining(
        `${admins[1]?.email}: missing from the list but the last active admin`
      ),
    ]);
  });

  it('counts a manual admin as the admin who remains', () => {
    const kept = Array.from({ length: 9 }, () => profile());
    const syncedAdmin = profile({ role: 'ADMIN' });
    const manualAdmin = profile({ role: 'ADMIN', manualAccount: true });
    const plan = ok(planEmployeeSync(kept.map(rowOf), [...kept, syncedAdmin, manualAdmin]));
    expect(plan.deactivate.map((p) => p.id)).toEqual([syncedAdmin.id]);
  });

  it('skips, with a warning, an e-mail two accounts share apart from letter case', () => {
    const upper = profile({ email: 'Jane.Doe@team.blue', hibobId: null });
    const lower = profile({ email: 'jane.doe@team.blue', hibobId: null });
    const plan = ok(
      planEmployeeSync(
        [{ id: 'hb-jane', email: 'jane.doe@team.blue', name: 'Jane' }],
        [upper, lower]
      )
    );
    expect(plan.update).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.warnings).toEqual([expect.stringContaining('different letter case')]);
  });

  it('does not create an account for a row outside @team.blue', () => {
    const plan = ok(
      planEmployeeSync(
        [
          { id: 'ext', email: 'someone@example.com', name: 'Ext' },
          { id: 'in', email: 'in@team.blue', name: 'In' },
        ],
        []
      )
    );
    expect(plan.create.map((row) => row.hibobId)).toEqual(['in']);
    expect(plan.warnings).toEqual([
      expect.stringContaining('someone@example.com: not a @team.blue'),
    ]);
  });
});

describe('fitSummary', () => {
  it('always satisfies the summary schema, whatever came from the database', () => {
    const long = (n: number) => 'x'.repeat(n);
    const summary: EmployeeSyncSummary = {
      received: 1,
      activeBefore: 1,
      created: Array.from({ length: 600 }, () => ({ email: 'a@team.blue', name: 'A' })),
      renamed: [{ email: `${long(400)}@team.blue`, from: long(300), to: 'B' }],
      deactivated: [
        {
          email: 'a@team.blue',
          name: long(300),
          freedDeskReservations: 0,
          freedParkingReservations: 0,
          removedWaitlistEntries: 0,
          rejectedRequests: 0,
          permanentDesks: Array.from({ length: 12 }, () => long(50)),
          ownedHives: Array.from({ length: 120 }, () => long(150)),
        },
      ],
      reactivated: [],
      linked: 0,
      unchanged: 0,
      warnings: [long(5000)],
    };
    expect(employeeSyncSummarySchema.safeParse(summary).success).toBe(false);

    const fitted = employeeSyncSummarySchema.parse(fitSummary(summary));

    expect(fitted.created).toHaveLength(500);
    expect(fitted.warnings[0]).toHaveLength(1000);
  });
});
