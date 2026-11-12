import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmployeeSyncRun } from '@garage/contract';
import { contractErrorResponse } from '../../../testing/stub-api';
import { bodiesOf, ok, serve, ServedProviders } from '../../../testing/serve-api';
import { AdminSyncScreen } from './admin-sync-screen';

jest.mock('@garage/auth/client', () => ({
  useRequireAuth: () => ({ status: 'authenticated' }),
}));
jest.mock('../../api-provider/api-provider', () => ({
  useApi: () => jest.requireActual('../../../testing/serve-api').servedApi(),
}));

const EMPTY_SUMMARY = {
  received: 0,
  activeBefore: 0,
  created: [],
  renamed: [],
  deactivated: [],
  reactivated: [],
  linked: 0,
  unchanged: 0,
  warnings: [],
};

const APPLIED: EmployeeSyncRun = {
  id: 'run-1',
  createdAt: '2026-11-10T07:30:00.000Z',
  source: 'keboola',
  mode: 'LIVE',
  status: 'OK',
  reason: null,
  summary: {
    received: 101,
    activeBefore: 100,
    created: [{ email: 'new@firma.cz', name: 'Nový Člověk' }],
    renamed: [{ email: 'a@firma.cz', from: 'Adela H.', to: 'Adéla Horáková' }],
    deactivated: [
      {
        email: 'gone@firma.cz',
        name: 'Odešlý Karel',
        freedDeskReservations: 3,
        freedParkingReservations: 1,
        removedWaitlistEntries: 0,
        rejectedRequests: 2,
        permanentDesks: ['D-007'],
        ownedHives: ['Engineering'],
      },
    ],
    reactivated: [{ email: 'back@firma.cz', name: 'Vrácený Petr' }],
    linked: 4,
    unchanged: 90,
    warnings: ['gone@firma.cz still owns a hive'],
  },
};

const REJECTED: EmployeeSyncRun = {
  id: 'run-2',
  createdAt: '2026-11-09T07:30:00.000Z',
  source: 'keboola',
  mode: 'DRY',
  status: 'REJECTED',
  reason: 'LIST_SHRANK: 10 rows is fewer than 90 % of 100 active users',
  summary: EMPTY_SUMMARY,
};

function renderScreen() {
  render(<AdminSyncScreen />, { wrapper: ServedProviders });
  return userEvent.setup();
}

const state = (extra: object = {}) => ({
  'admin/employeeSync/get': ok({
    configured: true,
    liveMode: false,
    runs: [APPLIED, REJECTED],
    ...extra,
  }),
});

describe('AdminSyncScreen', () => {
  it('shows the mode and tells the admin when the server has no key', async () => {
    serve(state({ configured: false }));
    renderScreen();

    expect(await screen.findByText('keyMissing')).toBeInTheDocument();
    expect(screen.getByText('keyMissingHint')).toBeInTheDocument();
    // The status line and the two runs' tags all say it; the first is the status.
    expect(screen.getAllByText('modeDry').length).toBeGreaterThan(0);
  });

  it('explains live mode and switches to it only on confirmation', async () => {
    const api = serve({
      ...state(),
      'admin/employeeSync/setLiveMode': ok({ liveMode: true }),
    });
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'switchToLive' }));

    expect(await screen.findByText('confirmLiveDescription')).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/employeeSync/setLiveMode')).toEqual([]);

    await u.click(screen.getByRole('button', { name: 'confirmLiveAction' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/employeeSync/setLiveMode')).toEqual([{ liveMode: true }])
    );
  });

  it('switches back to a dry run from live mode', async () => {
    const api = serve({
      ...state({ liveMode: true }),
      'admin/employeeSync/setLiveMode': ok({ liveMode: false }),
    });
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'switchToDry' }));
    await u.click(screen.getByRole('button', { name: 'confirmDryAction' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/employeeSync/setLiveMode')).toEqual([{ liveMode: false }])
    );
  });

  it('keeps the confirmation open and says so when the switch fails', async () => {
    serve({
      ...state(),
      'admin/employeeSync/setLiveMode': contractErrorResponse('FORBIDDEN'),
    });
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'switchToLive' }));
    await u.click(screen.getByRole('button', { name: 'confirmLiveAction' }));

    expect(await screen.findByText('errForbidden')).toBeInTheDocument();
    expect(screen.getByText('confirmLiveTitle')).toBeInTheDocument();
  });

  it('lists the runs and expands what one did', async () => {
    serve(state());
    renderScreen();

    const runs = await screen.findAllByText('keboola');
    expect(runs).toHaveLength(2);

    const first = runs[0]?.closest('details');
    if (first === null || first === undefined) throw new Error('no details element');
    const run = within(first);
    expect(run.getByText('sectionCreated: count=1')).toBeInTheDocument();
    expect(run.getByText('Nový Člověk (new@firma.cz)')).toBeInTheDocument();
    expect(
      run.getByText('renamedLine: email=a@firma.cz,from=Adela H.,to=Adéla Horáková')
    ).toBeInTheDocument();
    expect(run.getByText(/Odešlý Karel/u)).toHaveTextContent(
      'deactivatedFreed: deskReservations=3,parkingReservations=1,waitlist=0,requests=2'
    );
    expect(run.getByText(/Odešlý Karel/u)).toHaveTextContent(
      'deactivatedPermanentDesks: desks=D-007'
    );
    expect(run.getByText(/Odešlý Karel/u)).toHaveTextContent(
      'deactivatedOwnedHives: hives=Engineering'
    );
    expect(run.getByText('Vrácený Petr (back@firma.cz)')).toBeInTheDocument();
    expect(run.getByText('gone@firma.cz still owns a hive')).toBeInTheDocument();
  });

  it('translates a rejection code and keeps the English detail', async () => {
    serve(state());
    renderScreen();

    expect(await screen.findByText('reasonListShrank')).toBeInTheDocument();
    expect(screen.getByText('10 rows is fewer than 90 % of 100 active users')).toBeInTheDocument();
    expect(screen.getByText('statusRejected')).toBeInTheDocument();
  });
});
