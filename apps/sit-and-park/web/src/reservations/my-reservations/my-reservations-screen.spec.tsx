import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import type { MyDeskReservation, MyParkingReservation, MyProfile } from '@sit-and-park/contract';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  transportErrorResponse,
} from '../../testing/stub-api';
import type { StubbedApi, StubbedResponse } from '../../testing/stub-api';
import { profile } from '../../testing/fixtures';
import { createProviderWrapper } from '../../testing/providers';
import { MyReservationsScreen } from './my-reservations-screen';

/**
 * The screen runs against a real `createApiClient` with only `fetch` stubbed
 * (`stubApi`); the factory below swaps the client `ApiProvider` builds for that
 * one. `todayInPrague` is pinned (a Tuesday) so the upcoming/history split is
 * deterministic.
 */
const TODAY = '2026-09-15';

jest.mock('@sit-and-park/i18n', () => ({
  ...jest.requireActual('@sit-and-park/i18n'),
  todayInPrague: () => '2026-09-15',
}));
jest.mock('@sit-and-park/auth/client', () => ({
  useRequireAuth: () => ({ status: 'authenticated' }),
  useSession: () => ({ status: 'authenticated' }),
  useAccessTokenProvider: () => mockGetAccessToken,
}));
const mockGetAccessToken = async () => 'token';

let mockClient: StubbedApi['client'];
jest.mock('@sit-and-park/api-client', () => {
  const actual = jest.requireActual('@sit-and-park/api-client');
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

function parking(id: string, date: string, parkingSpotLabel = 'E2.65'): MyParkingReservation {
  return {
    id,
    parkingSpotId: 'spot-1',
    userId: 'user-viewer',
    guestName: null,
    licensePlate: null,
    date,
    createdAt: '2026-09-01T08:00:00.000Z',
    parkingSpotLabel,
  };
}

interface World {
  reservations: MyDeskReservation[];
  parking: MyParkingReservation[];
  /** `reservation.myMonth`'s `reservedDates`. */
  parkingDates: string[];
  waitlist: { date: string; parkingSpotLabel: string; position: number }[];
  releases: unknown;
  requests: unknown[];
  pending: unknown[];
  me: MyProfile;
  /** Per-path override; wins over the default answer. */
  override: Record<string, () => StubbedResponse>;
}

async function setup(partial: Partial<World> = {}, view: 'list' | 'calendar' = 'list') {
  const world: World = {
    reservations: [],
    parking: [],
    parkingDates: [],
    waitlist: [],
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
      case 'reservation/myMonth':
        return res({
          month: '2026-09',
          reservedDates: world.parkingDates,
          count: world.parkingDates.length,
          cap: null,
          reservations: world.parkingDates.map((date) => ({
            date,
            reservationId: `res-${date}`,
            parkingSpotId: 'spot-1',
            parkingSpotLabel: 'A1',
          })),
          waitlist: world.waitlist.map((entry) => ({ ...entry, parkingSpotId: 'spot-2' })),
        });
      case 'desk/myReservations':
        return res({ reservations: world.reservations });
      case 'reservation/myReservations':
        return res({ reservations: world.parking });
      case 'reservation/cancel':
        return res({
          reservationId: 'x',
          date: TODAY,
          parkingSpotId: 'spot-1',
          promoted: false,
        });
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
  render(<MyReservationsScreen />, { wrapper: createProviderWrapper(queryClient) });
  const user = userEvent.setup();
  if (view === 'list') {
    await user.click(screen.getByRole('radio', { name: 'viewList' }));
  }
  return { api, world, user };
}

const paths = (api: StubbedApi) =>
  api.requests.map((request) => new URL(request.url).pathname.replace('/rpc/', ''));

describe('MyReservationsScreen reservations', () => {
  it('splits upcoming and history and says so when there is nothing', async () => {
    const { user } = await setup({
      reservations: [reservation('past', '2026-09-10', 'B-02'), reservation('today', TODAY)],
    });
    expect(await screen.findByText('A-01')).toBeInTheDocument();
    expect(screen.queryByText('B-02')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'historyToggle: count=1' }));
    expect(screen.getByText('B-02')).toBeInTheDocument();
    // a non-admin cannot cancel the past one: only the one upcoming cancel button exists
    expect(screen.getAllByRole('button', { name: /^cancelOneLabel/ })).toHaveLength(1);
  });

  it('lists parking and desk reservations in one list, marked by icon', async () => {
    await setup({
      parking: [parking('p1', '2026-09-16')],
      reservations: [reservation('r1', '2026-09-16')],
    });
    const rows = within(await screen.findByRole('region', { name: 'title' })).getAllByRole(
      'listitem'
    );
    expect(rows).toHaveLength(2);
    const [first, second] = rows as [HTMLElement, HTMLElement];
    expect(within(first).getByText('E2.65')).toBeInTheDocument();
    expect(within(first).getByRole('img', { name: 'kindParking' })).toBeInTheDocument();
    expect(within(second).getByText('A-01')).toBeInTheDocument();
    expect(within(second).getByRole('img', { name: 'kindDesk' })).toBeInTheDocument();
  });

  it('has no heading of its own in the list view', async () => {
    await setup();
    await screen.findByText('emptyAll');
    expect(screen.queryByRole('heading', { name: 'reservationsTitle' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
  });

  it('cancels a parking reservation through reservation.cancel', async () => {
    const { api, user } = await setup({ parking: [parking('p1', '2026-09-16')] });
    await user.click(await screen.findByRole('button', { name: /^cancelOneLabel: code=E2.65/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^cancelDialogDescriptionParking/)).toBeInTheDocument();
    const before = paths(api).filter((p) => p === 'reservation/myReservations').length;
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    await waitFor(() =>
      expect(paths(api).filter((p) => p === 'reservation/myReservations').length).toBeGreaterThan(
        before
      )
    );
    const call = api.requests[paths(api).indexOf('reservation/cancel')];
    expect(await call?.json()).toEqual({ json: { reservationId: 'p1' } });
    expect(paths(api)).not.toContain('desk/cancel');
    expect(await screen.findByText('cancelledOne')).toBeInTheDocument();
  });

  it('bulk-cancels a mixed selection, each through its own procedure', async () => {
    const { api, user } = await setup({
      parking: [parking('p1', '2026-09-16')],
      reservations: [reservation('r1', '2026-09-16')],
    });
    await user.click(await screen.findByLabelText('selectAll'));
    await user.click(screen.getByRole('button', { name: 'cancelSelected: count=2' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'bulkDialogConfirm' }));
    expect(await screen.findByText('cancelledMany: count=2')).toBeInTheDocument();
    expect(paths(api).filter((p) => p === 'reservation/cancel')).toHaveLength(1);
    expect(paths(api).filter((p) => p === 'desk/cancel')).toHaveLength(1);
  });

  it('shows the error with retry when the parking list fails', async () => {
    await setup({
      reservations: [reservation('r1', '2026-09-16')],
      override: { 'reservation/myReservations': () => transportErrorResponse(500, 'boom') },
    });
    expect(await screen.findByText('errorTitle')).toBeInTheDocument();
    expect(screen.queryByText('A-01')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });

  it('puts a past parking reservation in the history', async () => {
    await setup({ parking: [parking('p0', '2026-09-10')] });
    expect(await screen.findByText('emptyUpcoming')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'historyToggle: count=1' })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    await setup();
    expect(await screen.findByText('emptyAll')).toBeInTheDocument();
  });

  it('cancels one reservation after confirmation and refetches', async () => {
    const { api, user } = await setup({ reservations: [reservation('r1', '2026-09-16')] });
    await user.click(await screen.findByRole('button', { name: /^cancelOneLabel: code=A-01/ }));
    const dialog = await screen.findByRole('dialog');
    const before = paths(api).filter((p) => p === 'desk/myReservations').length;
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    await waitFor(() =>
      expect(paths(api).filter((p) => p === 'desk/myReservations').length).toBeGreaterThan(before)
    );
    const cancelCall = api.requests[paths(api).indexOf('desk/cancel')];
    expect(await cancelCall?.json()).toEqual({ json: { reservationId: 'r1' } });
    expect(await screen.findByText('cancelledOne')).toBeInTheDocument();
  });

  it('bulk-cancels selected rows and reports a partial failure', async () => {
    let calls = 0;
    const { api, user } = await setup({
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
  it('reports a partial failure when the parking cancel fails and the desk cancel succeeds', async () => {
    const { api, user } = await setup({
      parking: [parking('p1', '2026-09-16')],
      reservations: [reservation('r1', '2026-09-16')],
      override: { 'reservation/cancel': () => contractErrorResponse('FORBIDDEN') },
    });
    await user.click(await screen.findByLabelText('selectAll'));
    await user.click(screen.getByRole('button', { name: 'cancelSelected: count=2' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'bulkDialogConfirm' }));
    expect(await screen.findByText('bulkPartial: failed=1,total=2')).toBeInTheDocument();
    expect(paths(api)).toContain('reservation/cancel');
    expect(paths(api)).toContain('desk/cancel');
    expect(screen.getByRole('button', { name: 'cancelSelected: count=1' })).toBeInTheDocument();
  });
});

describe('MyReservationsScreen permanent desk', () => {
  const releases = {
    deskId: 'desk-9',
    code: 'P-09',
    releases: [
      { id: 'rel-free', date: '2026-09-21', reservedByName: null },
      { id: 'rel-booked', date: '2026-09-22', reservedByName: 'Jana Nováková' },
    ],
  };

  it('is absent without a permanent desk', async () => {
    await setup();
    await screen.findByText('emptyAll');
    expect(screen.queryByText(/releaseTitle/)).not.toBeInTheDocument();
  });

  it('releases the selected working days, minus a removed one', async () => {
    const { api, user } = await setup({ releases });
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
    await setup({ releases });
    expect(await screen.findByText(/^releasedBy.*Jana Nováková/)).toBeInTheDocument();
    expect(screen.getByText(/^releasedFree/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^revokeLabel/ });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
  });

  it('shows copy when a revoke loses the race', async () => {
    const { user } = await setup({
      releases,
      override: {
        'desk/cancelRelease': () => contractErrorResponse('DESK_RELEASE_ALREADY_RESERVED'),
      },
    });
    await user.click(await screen.findByRole('button', { name: /^revokeLabel: date=21/ }));
    expect(await screen.findByText('DESK_RELEASE_ALREADY_RESERVED')).toBeInTheDocument();
  });
});

describe('MyReservationsScreen requests', () => {
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
    const { api, user } = await setup({
      requests: [mine, { ...mine, id: 'req-2', status: 'APPROVED', deskCode: 'H-08' }],
    });
    expect(await screen.findByText('statusPENDING')).toBeInTheDocument();
    expect(screen.getByText('statusAPPROVED')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancelRequestLabel: code=H-07/ }));
    await waitFor(() => expect(paths(api)).toContain('desk/cancelRequest'));
    expect(screen.getAllByRole('button', { name: /^cancelRequestLabel/ })).toHaveLength(1);
  });

  it('shows the empty state', async () => {
    await setup();
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
    await setup();
    await screen.findByText('requestsEmpty');
    expect(screen.queryByText('inboxTitle')).not.toBeInTheDocument();
  });

  it('shows an empty inbox to a hive owner', async () => {
    await setup({ me: profile({ ownsHive: true }) });
    expect(await screen.findByText('inboxEmpty')).toBeInTheDocument();
  });

  it('approves a request', async () => {
    const { api, user } = await setup({ pending: [pending] });
    await user.click(await screen.findByRole('button', { name: /^approveLabel/ }));
    await waitFor(() => expect(paths(api)).toContain('desk/decideRequest'));
    const call = api.requests[paths(api).indexOf('desk/decideRequest')];
    expect(await call?.json()).toEqual({ json: { requestId: 'req-9', approve: true } });
  });

  it('shows the error copy when the desk got taken meanwhile', async () => {
    const { user } = await setup({
      pending: [pending],
      override: { 'desk/decideRequest': () => contractErrorResponse('DESK_ALREADY_RESERVED') },
    });
    await user.click(await screen.findByRole('button', { name: /^approveLabel/ }));
    expect(await screen.findByText('DESK_ALREADY_RESERVED')).toBeInTheDocument();
  });

  it.each([
    ['PERMANENT_DESK_HOLDER', 'errDecidePermanentHolder'],
    ['DESK_RESERVATION_LIMIT_REACHED', 'errDecideLimitReached'],
    ['PAST_DATE', 'errDecidePast'],
  ])('words %s from the decider’s point of view', async (code, copy) => {
    const { user } = await setup({
      pending: [pending],
      override: { 'desk/decideRequest': () => contractErrorResponse(code as never) },
    });
    await user.click(await screen.findByRole('button', { name: /^approveLabel/ }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });
});

describe('MyReservationsScreen calendar', () => {
  const request = {
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

  it('opens on the calendar and shows each event as a typed icon and the place id', async () => {
    await setup(
      {
        parkingDates: ['2026-09-16', '2026-09-17'],
        reservations: [reservation('r1', '2026-09-16')],
        requests: [request],
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    expect(within(grid).getAllByText('A1')).toHaveLength(2);
    expect(within(grid).getAllByRole('img', { name: 'kindParking' })).toHaveLength(2);
    expect(within(grid).getByText('A-01')).toBeInTheDocument();
    expect(
      within(grid).getByText('eventRequest: code=H-07,status=requestPENDING')
    ).toBeInTheDocument();
    expect(within(grid).getAllByRole('img', { name: 'kindDesk' })).toHaveLength(2); // desk + request
    expect(
      within(grid).queryByText(/^(eventParking|eventDesk|eventPermanent)/)
    ).not.toBeInTheDocument();
  });

  it('colours each event by its type', async () => {
    await setup(
      {
        parkingDates: ['2026-09-16'],
        reservations: [reservation('r1', '2026-09-16')],
        requests: [request],
        waitlist: [{ date: '2026-09-17', parkingSpotLabel: 'B2', position: 2 }],
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    const item = (text: string | RegExp) => within(grid).getByText(text).closest('li');
    expect(item('A1')).toHaveAttribute('data-type', 'parking');
    expect(item(/^eventWaitlist/)).toHaveAttribute('data-type', 'parking');
    expect(item('A-01')).toHaveAttribute('data-type', 'desk');
    expect(item(/^eventRequest/)).toHaveAttribute('data-type', 'desk');
  });

  it('shows the approval inbox below the calendar for a hive owner or admin', async () => {
    await setup(
      {
        me: profile({ ownsHive: true }),
        pending: [
          {
            ...request,
            id: 'req-9',
            userId: 'user-other',
            hiveId: 'hive-1',
            hiveName: 'Hive Modrý',
            requesterName: 'Petr Novák',
          },
        ],
      },
      'calendar'
    );
    expect(await screen.findByRole('grid', { name: 'calendarLabel' })).toBeInTheDocument();
    expect(await screen.findByText('inboxTitle')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^approveLabel/ })).toBeInTheDocument();
  });

  it('shows no list of my own reservations in the calendar view', async () => {
    await setup({}, 'calendar');
    await screen.findByRole('grid', { name: 'calendarLabel' });
    await screen.findByText('requestsEmpty');
    expect(screen.queryByRole('region', { name: 'title' })).not.toBeInTheDocument();
  });

  async function openEvent(name: string, partial: Parameters<typeof setup>[0]) {
    const { api, user } = await setup(partial, 'calendar');
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    await user.click(within(grid).getByRole('button', { name }));
    return { api, user, grid, dialog: await screen.findByRole('dialog') };
  }

  it("opens a desk reservation's detail from the calendar and links to it on the plan", async () => {
    const { dialog } = await openEvent('kindDesk A-01', {
      reservations: [reservation('r1', '2026-09-16')],
    });
    expect(within(dialog).getByText('detailTitle: code=A-01')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'showOnPlan' })).toHaveAttribute(
      'href',
      '/desks?date=2026-09-16&desk=desk-A-01'
    );
    expect(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' })).toBeInTheDocument();
  });

  it('cancels a desk reservation from the detail dialog', async () => {
    const { api, user, dialog } = await openEvent('kindDesk A-01', {
      reservations: [reservation('r1', '2026-09-16')],
    });
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    expect(await screen.findByText('cancelledOne')).toBeInTheDocument();
    const call = api.requests[paths(api).indexOf('desk/cancel')];
    expect(await call?.json()).toEqual({ json: { reservationId: 'r1' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancels a parking day from the detail dialog, without a plan link', async () => {
    const { api, user, dialog } = await openEvent('kindParking A1', {
      parkingDates: ['2026-09-16'],
    });
    expect(within(dialog).getByText('detailTitle: code=A1')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'showOnPlan' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    expect(await screen.findByText('cancelledOne')).toBeInTheDocument();
    const call = api.requests[paths(api).indexOf('reservation/cancel')];
    expect(await call?.json()).toEqual({ json: { reservationId: 'res-2026-09-16' } });
  });

  it('reports a failed cancel and keeps the event', async () => {
    const { user, grid, dialog } = await openEvent('kindDesk A-01', {
      reservations: [reservation('r1', '2026-09-16')],
      override: { 'desk/cancel': () => contractErrorResponse('PAST_DATE') },
    });
    await user.click(within(dialog).getByRole('button', { name: 'cancelDialogConfirm' }));
    expect(await screen.findByText('errCancelPast')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(grid).getByText('A-01')).toBeInTheDocument();
  });

  it('keeps other event kinds and past days for a non-admin as plain text', async () => {
    await setup(
      {
        waitlist: [{ date: '2026-09-17', parkingSpotLabel: 'B2', position: 2 }],
        requests: [request],
        releases: {
          deskId: 'desk-9',
          code: 'P-09',
          releases: [{ id: 'rel-free', date: '2026-09-21', reservedByName: null }],
        },
        reservations: [reservation('r0', '2026-09-14')],
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    await within(grid).findByText('A-01');
    await within(grid).findByText('eventWaitlist: label=B2,position=2');
    await within(grid).findByText('eventRequest: code=H-07,status=requestPENDING');
    await within(grid).findByText('eventReleased: code=P-09');
    expect(within(grid).queryAllByRole('button')).toHaveLength(0);
  });

  it('lets an admin open a past reservation', async () => {
    await setup(
      { me: profile({ role: 'ADMIN' }), reservations: [reservation('r0', '2026-09-14')] },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(await within(grid).findByRole('button', { name: 'kindDesk A-01' })).toBeInTheDocument();
  });

  it('shows a waitlist entry as text and does not warn about it', async () => {
    await setup(
      { waitlist: [{ date: '2026-09-17', parkingSpotLabel: 'B2', position: 2 }] },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getByText('eventWaitlist: label=B2,position=2')).toBeInTheDocument();
    expect(within(grid).getByRole('img', { name: 'kindParking' })).toBeInTheDocument();
    expect(within(grid).queryByText('warningNoDesk')).not.toBeInTheDocument();
  });

  it('shows permanent-desk days by code and released days as released', async () => {
    await setup(
      {
        releases: {
          deskId: 'desk-9',
          code: 'P-09',
          releases: [{ id: 'rel-free', date: '2026-09-21', reservedByName: null }],
        },
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getAllByText('P-09').length).toBeGreaterThan(0);
    expect(within(grid).getByText('eventReleased: code=P-09')).toBeInTheDocument();
    expect(within(grid).getByText('eventReleased: code=P-09').closest('li')).toHaveAttribute(
      'data-type',
      'desk'
    );
    for (const li of within(grid)
      .getAllByText('P-09')
      .map((el) => el.closest('li'))) {
      expect(li).toHaveAttribute('data-type', 'desk');
    }
    expect(within(grid).getAllByRole('img', { name: 'kindDesk' }).length).toBeGreaterThan(0);
    expect(within(grid).queryByText(/^eventPermanent/)).not.toBeInTheDocument();
  });

  it('marks only the parking day without a desk', async () => {
    await setup(
      {
        parkingDates: ['2026-09-16', '2026-09-17'],
        reservations: [reservation('r1', '2026-09-16')],
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getAllByText('warningNoDesk')).toHaveLength(1);
  });

  it('lists the same days in the agenda for narrow screens', async () => {
    await setup({ parkingDates: ['2026-09-17'] }, 'calendar');
    const agenda = await screen.findByRole('region', { name: 'agendaLabel' });
    expect(within(agenda).getByText('A1')).toBeInTheDocument();
    expect(within(agenda).getByRole('img', { name: 'kindParking' })).toBeInTheDocument();
    expect(within(agenda).getByText('warningNoDesk')).toBeInTheDocument();
  });

  it('says so when the month is empty', async () => {
    await setup({}, 'calendar');
    expect(await screen.findByText('agendaEmpty')).toBeInTheDocument();
  });

  it('navigates months and asks for that month’s parking', async () => {
    const { api, user } = await setup({}, 'calendar');
    await screen.findByRole('grid', { name: 'calendarLabel' });
    await user.click(screen.getByRole('button', { name: 'calNext' }));
    await waitFor(() => {
      const months = api.requests
        .filter((request) => request.url.endsWith('reservation/myMonth'))
        .map((request) => request.clone().json());
      expect(months).toHaveLength(2);
    });
    const bodies = await Promise.all(
      api.requests
        .filter((request) => request.url.endsWith('reservation/myMonth'))
        .map((request) => request.json())
    );
    expect(bodies.map((body: { json: { month: string } }) => body.json.month)).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });

  it('a failed month keeps the navigation, so another month can be tried', async () => {
    const { user } = await setup(
      { override: { 'reservation/myMonth': () => transportErrorResponse(500, 'boom') } },
      'calendar'
    );
    expect(await screen.findByText('errorTitle')).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'calendarLabel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'calNext' }));
    expect(screen.getByRole('button', { name: 'calPrev' })).toBeInTheDocument();
  });

  it('failed desk requests or releases only add a notice: the calendar still renders', async () => {
    await setup(
      {
        parkingDates: ['2026-09-16'],
        reservations: [reservation('r1', '2026-09-16')],
        override: {
          'desk/myRequests': () => transportErrorResponse(500, 'boom'),
          'desk/myReleases': () => transportErrorResponse(500, 'boom'),
        },
      },
      'calendar'
    );
    const grid = await screen.findByRole('grid', { name: 'calendarLabel' });
    expect(within(grid).getByText('A-01')).toBeInTheDocument();
    expect(screen.getByText(/calendarPartialError/)).toBeInTheDocument();
    // the sections below fail on their own and each has a retry of its own
    expect(screen.getAllByRole('button', { name: 'retry' }).length).toBeGreaterThanOrEqual(1);
  });
});
