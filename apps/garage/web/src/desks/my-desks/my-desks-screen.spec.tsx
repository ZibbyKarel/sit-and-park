import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import type { MyDeskReservation, MyProfile } from '@garage/contract';
import { contractErrorResponse, rpcPayload, stubApi } from '../../testing/stub-api';
import type { StubbedApi, StubbedResponse } from '../../testing/stub-api';
import { profile } from '../../testing/fixtures';
import { createProviderWrapper } from '../../testing/providers';
import { MyDesksScreen } from './my-desks-screen';

/**
 * The screen runs against a real `createApiClient` with only `fetch` stubbed
 * (`stubApi`); the factory below swaps the client `ApiProvider` builds for that
 * one. `todayInPrague` is pinned (a Tuesday) so the upcoming/history split is
 * deterministic.
 */
const TODAY = '2026-09-15';

jest.mock('@garage/i18n', () => ({
  ...jest.requireActual('@garage/i18n'),
  todayInPrague: () => '2026-09-15',
}));
jest.mock('@garage/auth/client', () => ({
  useRequireAuth: () => ({ status: 'authenticated' }),
  useSession: () => ({ status: 'authenticated' }),
  useAccessTokenProvider: () => mockGetAccessToken,
}));
const mockGetAccessToken = async () => 'token';

let mockClient: StubbedApi['client'];
jest.mock('@garage/api-client', () => {
  const actual = jest.requireActual('@garage/api-client');
  return {
    ...actual,
    // `stubApi` itself builds its client through `createApiClient` (always with
    // a `fetch`); only the provider's call (no `fetch`) is redirected.
    createApiClient: (options: { fetch?: unknown }) =>
      options.fetch === undefined ? mockClient : actual.createApiClient(options),
  };
});

function res(value: unknown): StubbedResponse {
  return { status: 200, body: rpcPayload(value) };
}

function reservation(id: string, date: string, deskCode = 'A-01'): MyDeskReservation {
  return {
    id,
    deskId: `desk-${deskCode}`,
    userId: 'user-viewer',
    date,
    createdAt: '2026-09-01T08:00:00.000Z',
    deskCode,
    zoneName: 'Zóna A',
    hiveName: 'Hive Modrý',
  };
}

interface World {
  reservations: MyDeskReservation[];
  releases: unknown;
  requests: unknown[];
  pending: unknown[];
  me: MyProfile;
  /** Per-path override; wins over the default answer. */
  override: Record<string, () => StubbedResponse>;
}

function setup(partial: Partial<World> = {}) {
  const world: World = {
    reservations: [],
    releases: null,
    requests: [],
    pending: [],
    me: profile(),
    override: {},
    ...partial,
  };
  const api = stubApi((index) => {
    const path = new URL(api.requests[index]?.url ?? 'http://x/').pathname.replace('/rpc/', '');
    const override = world.override[path];
    if (override) {
      return override();
    }
    switch (path) {
      case 'me/get':
        return res(world.me);
      case 'desk/myReservations':
        return res({ reservations: world.reservations });
      case 'desk/myReleases':
        return res(world.releases);
      case 'desk/myRequests':
        return res({ requests: world.requests });
      case 'desk/pendingRequests':
        return res({ requests: world.pending });
      case 'desk/cancel':
        return res({ reservationId: 'x', date: TODAY, deskId: 'd' });
      case 'desk/release':
        return res({ added: 2 });
      case 'desk/cancelRelease':
        return res({ releaseId: 'x' });
      case 'desk/cancelRequest':
        return res({ requestId: 'x' });
      case 'desk/decideRequest':
        return res({ request: {}, reservation: null });
      default:
        throw new Error(`unexpected call ${path}`);
    }
  });
  mockClient = api.client;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MyDesksScreen />, { wrapper: createProviderWrapper(queryClient) });
  return { api, world, user: userEvent.setup() };
}

const paths = (api: StubbedApi) =>
  api.requests.map((request) => new URL(request.url).pathname.replace('/rpc/', ''));

describe('MyDesksScreen reservations', () => {
  it('splits upcoming and history and says so when there is nothing', async () => {
    const { user } = setup({
      reservations: [reservation('past', '2026-09-10', 'B-02'), reservation('today', TODAY)],
    });
    expect(await screen.findByText('A-01')).toBeInTheDocument();
    expect(screen.queryByText('B-02')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'historyToggle: count=1' }));
    expect(screen.getByText('B-02')).toBeInTheDocument();
    // a non-admin cannot cancel the past one: only the one upcoming cancel button exists
    expect(screen.getAllByRole('button', { name: /^cancelOneLabel/ })).toHaveLength(1);
  });

  it('shows the empty state', async () => {
    setup();
    expect(await screen.findByText('emptyAll')).toBeInTheDocument();
  });

  it('cancels one reservation after confirmation and refetches', async () => {
    const { api, user } = setup({ reservations: [reservation('r1', '2026-09-16')] });
    await user.click(await screen.findByRole('button', { name: /^cancelOneLabel: code=A-01/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    await waitFor(() =>
      expect(paths(api).filter((p) => p === 'desk/myReservations')).toHaveLength(2)
    );
    const cancelCall = api.requests[paths(api).indexOf('desk/cancel')];
    expect(await cancelCall?.json()).toEqual({ json: { reservationId: 'r1' } });
    expect(await screen.findByText('cancelledOne')).toBeInTheDocument();
  });

  it('bulk-cancels selected rows and reports a partial failure', async () => {
    let calls = 0;
    const { api, user } = setup({
      reservations: [
        reservation('r1', '2026-09-16', 'A-01'),
        reservation('r2', '2026-09-17', 'A-02'),
      ],
      override: {
        'desk/cancel': () => {
          calls += 1;
          return calls === 1
            ? res({ reservationId: 'r1', date: '2026-09-16', deskId: 'd' })
            : contractErrorResponse('FORBIDDEN');
        },
      },
    });
    await user.click(await screen.findByLabelText('selectAll'));
    await user.click(screen.getByRole('button', { name: 'cancelSelected: count=2' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'bulkDialogConfirm' }));
    expect(await screen.findByText('bulkPartial: failed=1,total=2')).toBeInTheDocument();
    expect(paths(api).filter((p) => p === 'desk/cancel')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'cancelSelected: count=1' })).toBeInTheDocument();
  });

  it('draws the Monday-to-Friday calendar view', async () => {
    const { user } = setup({ reservations: [reservation('r1', '2026-09-16')] });
    await screen.findByText('A-01');
    await user.click(screen.getByRole('radio', { name: 'viewCalendar' }));
    const grid = screen.getByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(grid).getByText('A-01')).toBeInTheDocument();
    expect(screen.getByText('calCount: count=1')).toBeInTheDocument();
  });
});

describe('MyDesksScreen permanent desk', () => {
  const releases = {
    deskId: 'desk-9',
    code: 'P-09',
    releases: [
      { id: 'rel-free', date: '2026-09-21', reservedByName: null },
      { id: 'rel-booked', date: '2026-09-22', reservedByName: 'Jana Nováková' },
    ],
  };

  it('is absent without a permanent desk', async () => {
    setup();
    await screen.findByText('emptyAll');
    expect(screen.queryByText(/releaseTitle/)).not.toBeInTheDocument();
  });

  it('releases the selected working days, minus a removed one', async () => {
    const { api, user } = setup({ releases });
    await screen.findByText('releaseTitle: code=P-09');
    fireEvent.change(screen.getByLabelText('releaseTo'), { target: { value: '2026-09-17' } });
    await user.click(await screen.findByRole('button', { name: /^releaseRemoveDate: date=16/ }));
    await user.click(screen.getByRole('button', { name: 'releaseSubmit: count=2' }));
    await waitFor(() => expect(paths(api)).toContain('desk/release'));
    const call = api.requests[paths(api).indexOf('desk/release')];
    expect(await call?.json()).toEqual({ json: { dates: [TODAY, '2026-09-17'] } });
    expect(await screen.findByText('releasedAdded: count=2')).toBeInTheDocument();
  });

  it('lists releases with the booker and disables revoke where booked', async () => {
    setup({ releases });
    expect(await screen.findByText(/^releasedBy.*Jana Nováková/)).toBeInTheDocument();
    expect(screen.getByText(/^releasedFree/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^revokeLabel/ });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
  });

  it('shows copy when a revoke loses the race', async () => {
    const { user } = setup({
      releases,
      override: {
        'desk/cancelRelease': () => contractErrorResponse('DESK_RELEASE_ALREADY_RESERVED'),
      },
    });
    await user.click(await screen.findByRole('button', { name: /^revokeLabel: date=21/ }));
    expect(await screen.findByText('DESK_RELEASE_ALREADY_RESERVED')).toBeInTheDocument();
  });
});

describe('MyDesksScreen requests', () => {
  const mine = {
    id: 'req-1',
    deskId: 'd',
    userId: 'user-viewer',
    date: '2026-09-18',
    status: 'PENDING',
    decidedById: null,
    decidedAt: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    deskCode: 'H-07',
    zoneName: 'Zóna H',
  };

  it('shows status and cancels a pending request', async () => {
    const { api, user } = setup({
      requests: [mine, { ...mine, id: 'req-2', status: 'APPROVED', deskCode: 'H-08' }],
    });
    expect(await screen.findByText('statusPENDING')).toBeInTheDocument();
    expect(screen.getByText('statusAPPROVED')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancelRequestLabel: code=H-07/ }));
    await waitFor(() => expect(paths(api)).toContain('desk/cancelRequest'));
    expect(screen.getAllByRole('button', { name: /^cancelRequestLabel/ })).toHaveLength(1);
  });

  it('shows the empty state', async () => {
    setup();
    expect(await screen.findByText('requestsEmpty')).toBeInTheDocument();
  });

  const pending = {
    ...mine,
    id: 'req-9',
    userId: 'user-other',
    hiveId: 'hive-1',
    hiveName: 'Hive Modrý',
    requesterName: 'Petr Novák',
  };

  it('hides the inbox from a plain user with nothing to decide', async () => {
    setup();
    await screen.findByText('requestsEmpty');
    expect(screen.queryByText('inboxTitle')).not.toBeInTheDocument();
  });

  it('shows an empty inbox to a hive owner', async () => {
    setup({ me: profile({ ownsHive: true }) });
    expect(await screen.findByText('inboxEmpty')).toBeInTheDocument();
  });

  it('approves a request', async () => {
    const { api, user } = setup({ pending: [pending] });
    await user.click(await screen.findByRole('button', { name: /^approveLabel/ }));
    await waitFor(() => expect(paths(api)).toContain('desk/decideRequest'));
    const call = api.requests[paths(api).indexOf('desk/decideRequest')];
    expect(await call?.json()).toEqual({ json: { requestId: 'req-9', approve: true } });
  });

  it('shows the error copy when the desk got taken meanwhile', async () => {
    const { user } = setup({
      pending: [pending],
      override: { 'desk/decideRequest': () => contractErrorResponse('DESK_ALREADY_RESERVED') },
    });
    await user.click(await screen.findByRole('button', { name: /^approveLabel/ }));
    expect(await screen.findByText('DESK_ALREADY_RESERVED')).toBeInTheDocument();
  });
});
