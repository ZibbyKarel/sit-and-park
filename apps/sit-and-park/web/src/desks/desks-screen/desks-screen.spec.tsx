import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { LocalizationProvider } from '@shoptet/ui';
import { createApiQueryUtils, type ApiQueryUtils } from '@sit-and-park/api-client';
import { IntlProvider } from '@sit-and-park/i18n';
import type { DirectoryDesk } from '@sit-and-park/contract';
import cs from '../../../messages/cs.json';
import { createQueryClient } from '../../shell/query/query-client';
import { ToastProvider } from '../../shell/notifications/toast-provider';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  type StubbedApi,
  type StubbedResponse,
} from '../../testing/stub-api';
import { T0, profile } from '../../testing/fixtures';
import { directory, directoryDesk } from '../desk.test-helpers';
import { DesksScreen } from './desks-screen';

/**
 * The connected screen over a real `ApiClient` whose `fetch` is stubbed
 * (`stubApi`), so what is asserted is what reached the wire. Doubled at the
 * wrapper boundary only: the session, the socket, the router.
 */

const DATE = '2026-11-16'; // a Monday

jest.mock('@sit-and-park/i18n', () => ({
  ...jest.requireActual('@sit-and-park/i18n'),
  todayInPrague: () => '2026-11-16',
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock('@sit-and-park/auth/client', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));
let mockSearch = '';
let mockRealtimeStatus = 'connected';
jest.mock('@sit-and-park/realtime-client', () => ({
  useDayRoom: jest.fn(),
  useRealtime: () => ({ status: mockRealtimeStatus, reconnect: jest.fn() }),
  useRealtimeEvent: jest.fn(),
}));

let mockApi: ApiQueryUtils;
jest.mock('../../shell/api-provider/api-provider', () => ({ useApi: () => mockApi }));

const ok = (value: unknown): StubbedResponse => ({ status: 200, body: rpcPayload(value) });

type Routes = Record<string, StubbedResponse>;

/** Answers by procedure path (`desk/reserve`); an unrouted call fails the test loudly. */
function serve(routes: Routes): StubbedApi {
  const api: StubbedApi = stubApi((index) => {
    const path = new URL(api.requests[index]?.url ?? '').pathname.replace(/^\/rpc\//, '');
    const response = routes[path] ?? (path === 'me/get' ? ok(profile()) : undefined);
    if (response === undefined) throw new Error(`unrouted call to ${path}`);
    return response;
  });
  mockApi = createApiQueryUtils(api.client);
  return api;
}

async function bodiesOf(api: StubbedApi, path: string): Promise<unknown[]> {
  const matching = api.requests.filter((request) => request.url.endsWith(`/rpc/${path}`));
  return Promise.all(
    matching.map(async (request) => ((await request.clone().json()) as { json: unknown }).json)
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <IntlProvider locale="cs" messages={cs}>
        <LocalizationProvider locale="cs-CZ">
          <ToastProvider>{children}</ToastProvider>
        </LocalizationProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
}

function renderScreen() {
  render(<DesksScreen />, { wrapper: Wrapper });
  return userEvent.setup();
}

const FREE = directoryDesk({ id: 'desk-free', code: 'D-001' });
const HIVE = directoryDesk({
  id: 'desk-hive',
  code: 'D-014',
  hiveId: 'hive-1',
  hiveName: 'Engineering',
  hiveColor: '#3366FF',
  access: 'APPROVAL',
});

function reservation(date: string, deskId = FREE.id) {
  return { id: `res-${date}`, deskId, userId: 'user-viewer', date, createdAt: T0 };
}

async function openDesk(user: ReturnType<typeof userEvent.setup>, desk: DirectoryDesk) {
  await user.click(
    await screen.findByRole('button', {
      name: new RegExp(`^deskAria(Hive)?: code=${desk.code},`),
    })
  );
  return screen.findByRole('dialog');
}

describe('DesksScreen', () => {
  it('draws one plan shape per desk with its Czech accessible name, and the same desks as a list', async () => {
    const api = serve({ 'desk/directory': ok(directory([FREE, HIVE])) });
    const user = renderScreen();

    expect(
      await screen.findByRole('button', { name: 'deskAria: code=D-001,status=statusFree' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'deskAriaHive: code=D-014,status=statusFree,hive=Engineering',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('freeCount: free=2,total=2')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/directory')).toEqual([{ date: DATE }]);

    await user.click(screen.getByRole('tab', { name: 'viewList' }));
    expect(screen.getByRole('button', { name: 'listOpenDesk: code=D-001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'listOpenDesk: code=D-014' })).toBeInTheDocument();
  });

  it('explains a missing office instead of drawing a plan', async () => {
    serve({ 'desk/directory': contractErrorResponse('NO_OFFICE_ASSIGNED') });
    renderScreen();

    expect(await screen.findByText('noOfficeTitle')).toBeInTheDocument();
    expect(screen.getByText('NO_OFFICE_ASSIGNED')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('tells a permanent holder they cannot book and links to my desks', async () => {
    serve({
      'desk/directory': ok(
        directory([
          FREE,
          directoryDesk({ id: 'mine', code: 'D-100', status: 'ASSIGNED', assignedToMe: true }),
        ])
      ),
    });
    renderScreen();

    expect(await screen.findByText('bannerPermanent: code=D-100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'bannerPermanentLink' })).toHaveAttribute(
      'href',
      '/reservations'
    );
  });

  it('names the desk the viewer has that day and cancels it from the banner', async () => {
    const api = serve({
      'desk/directory': ok(
        directory([
          FREE,
          directoryDesk({
            id: 'd2',
            code: 'D-002',
            status: 'RESERVED_BY_ME',
            myReservationId: 'res-1',
          }),
        ])
      ),
      'desk/cancel': ok({ reservationId: 'res-1', date: DATE, deskId: 'd2' }),
    });
    const user = renderScreen();

    expect(await screen.findByText('bannerToday: code=D-002')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'bannerTodayCancel' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'desk/cancel')).toEqual([{ reservationId: 'res-1' }])
    );
    await waitFor(async () => expect(await bodiesOf(api, 'desk/directory')).toHaveLength(2));
  });

  it('books a free desk for the day and shows the result', async () => {
    const api = serve({
      'desk/directory': ok(directory([FREE])),
      'desk/reserve': ok({ reserved: [reservation(DATE)], skipped: [] }),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, FREE);
    expect(within(dialog).getByText('dialogTitle: code=D-001')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'bookDay' }));

    expect(await within(dialog).findByText('seriesResultReserved: count=1')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/reserve')).toEqual([{ deskId: 'desk-free', dates: [DATE] }]);
  });

  it('previews a series day by day, books it and summarises reserved and skipped days', async () => {
    const api = serve({
      'desk/directory': ok(directory([FREE])),
      'desk/previewSeries': ok({
        days: [
          { date: '2026-11-16', ok: true, reason: null },
          { date: '2026-11-17', ok: false, reason: 'DESK_TAKEN' },
          { date: '2026-11-18', ok: true, reason: null },
        ],
      }),
      'desk/reserve': ok({
        reserved: [reservation('2026-11-16'), reservation('2026-11-18')],
        skipped: [{ date: '2026-11-17', reason: 'DESK_TAKEN' }],
      }),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, FREE);
    await user.click(within(dialog).getByRole('button', { name: 'seriesOpen' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /úterý/i }));
    await user.click(within(dialog).getByRole('checkbox', { name: /středa/i }));

    expect(await within(dialog).findByText('skipDeskTaken')).toBeInTheDocument();
    expect((await bodiesOf(api, 'desk/previewSeries')).at(-1)).toEqual({
      deskId: 'desk-free',
      dates: ['2026-11-16', '2026-11-17', '2026-11-18'],
    });

    await user.click(within(dialog).getByRole('button', { name: 'seriesSubmit: count=2' }));

    expect(await within(dialog).findByText('seriesResultReserved: count=2')).toBeInTheDocument();
    expect(within(dialog).getByText('seriesResultSkipped: count=1')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/reserve')).toEqual([
      { deskId: 'desk-free', dates: ['2026-11-16', '2026-11-17', '2026-11-18'] },
    ]);
  });

  it('requests approval for a free hive desk without direct access', async () => {
    const api = serve({
      'desk/directory': ok(directory([HIVE])),
      'desk/requestApproval': ok({
        id: 'req-1',
        deskId: HIVE.id,
        userId: 'user-viewer',
        date: DATE,
        status: 'PENDING',
        decidedById: null,
        decidedAt: null,
        createdAt: T0,
      }),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, HIVE);
    expect(within(dialog).queryByRole('button', { name: 'bookDay' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'requestApproval' }));

    expect(await within(dialog).findByText('requestSent')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/requestApproval')).toEqual([{ deskId: HIVE.id, date: DATE }]);
  });

  it('withdraws the viewer’s pending request instead of offering a new one', async () => {
    const waiting = { ...HIVE, myPendingRequestId: 'req-1' };
    const api = serve({
      'desk/directory': ok(directory([waiting])),
      'desk/cancelRequest': ok({ requestId: 'req-1' }),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, waiting);
    expect(within(dialog).getByText('notePendingRequest')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'requestApproval' })
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'cancelRequest' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await bodiesOf(api, 'desk/cancelRequest')).toEqual([{ requestId: 'req-1' }]);
  });

  it('cancels the viewer’s own booking from the dialog', async () => {
    const mine = directoryDesk({
      id: 'd2',
      code: 'D-002',
      status: 'RESERVED_BY_ME',
      myReservationId: 'res-1',
    });
    const api = serve({
      'desk/directory': ok(directory([mine])),
      'desk/cancel': ok({ reservationId: 'res-1', date: DATE, deskId: 'd2' }),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, mine);
    await user.click(within(dialog).getByRole('button', { name: 'cancelReservation' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await bodiesOf(api, 'desk/cancel')).toEqual([{ reservationId: 'res-1' }]);
  });

  it('shows a contract error as copy, keeping the dialog open', async () => {
    serve({
      'desk/directory': ok(directory([FREE])),
      'desk/reserve': contractErrorResponse('DESK_ALREADY_RESERVED'),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, FREE);
    await user.click(within(dialog).getByRole('button', { name: 'bookDay' }));

    expect(await within(dialog).findByText('DESK_ALREADY_RESERVED')).toBeInTheDocument();
  });

  it('words a refused approval request as this desk’s rule, not parking’s', async () => {
    serve({
      'desk/directory': ok(directory([HIVE])),
      'desk/requestApproval': contractErrorResponse('VALIDATION_FAILED'),
    });
    const user = renderScreen();

    const dialog = await openDesk(user, HIVE);
    await user.click(within(dialog).getByRole('button', { name: 'requestApproval' }));

    expect(await within(dialog).findByText('errRequestNotAllowed')).toBeInTheDocument();
  });

  it('offers a plain viewer neither booking nor cancelling on a past day', async () => {
    mockSearch = 'date=2026-11-09';
    const mine = directoryDesk({
      id: 'd2',
      code: 'D-002',
      status: 'RESERVED_BY_ME',
      myReservationId: 'res-1',
    });
    serve({ 'desk/directory': ok(directory([FREE, mine])) });
    const user = renderScreen();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bannerTodayCancel' })).not.toBeInTheDocument();
    const dialog = await openDesk(user, mine);
    expect(within(dialog).getByText('notePast')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'cancelReservation' })).toBeNull();
    mockSearch = '';
  });

  describe('bulk booking', () => {
    const SECOND = directoryDesk({ id: 'desk-second', code: 'D-002' });
    const asAdmin = {
      'me/get': ok(profile({ role: 'ADMIN' })),
      'admin/user/list': ok({ users: [] }),
    };

    async function ctrlClick(user: ReturnType<typeof userEvent.setup>, code: string) {
      await user.keyboard('{Control>}');
      await user.click(await screen.findByRole('button', { name: new RegExp(`code=${code},`) }));
      await user.keyboard('{/Control}');
    }

    it('opens the bulk modal from the header for a user, without any desk selection UI', async () => {
      serve({ 'desk/directory': ok(directory([FREE, SECOND])) });
      const user = renderScreen();

      await user.click(await screen.findByRole('button', { name: 'bulkOpen' }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText(/^poolNote/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^selectionCount/)).not.toBeInTheDocument();
      expect(screen.queryByText('planMultiHint')).not.toBeInTheDocument();
    });

    it('admin: Ctrl-click selects desks without opening the dialog, plain click still does', async () => {
      serve({ 'desk/directory': ok(directory([FREE, SECOND])), ...asAdmin });
      const user = renderScreen();

      await ctrlClick(user, 'D-001');
      await ctrlClick(user, 'D-002');

      expect(await screen.findByText('selectionCount: count=2')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'selectionClear' }));
      expect(screen.queryByText(/^selectionCount/)).not.toBeInTheDocument();

      await openDesk(user, FREE);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('admin: ticking desks in the list and opening the modal passes them as deskIds', async () => {
      const api = serve({
        'desk/directory': ok(directory([FREE, SECOND])),
        'desk/previewBulk': ok({
          month: '2026-11',
          people: [
            { id: 'user-viewer', name: 'Karel', officeId: 'office-1', preferredDeskId: null },
          ],
          rows: [{ outcome: 'UNASSIGNED', userId: 'user-viewer', date: '2026-11-16' }],
          freeDesks: [],
        }),
        ...asAdmin,
      });
      const user = renderScreen();

      await user.click(await screen.findByRole('tab', { name: 'viewList' }));
      await user.click(screen.getByRole('checkbox', { name: 'selectDesk: code=D-002' }));
      expect(await screen.findByText('selectionCount: count=1')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'bulkOpen' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('poolNote: count=1')).toBeInTheDocument();
      await user.click(
        within(dialog)
          .getAllByRole('button')
          .find((b) => b.textContent === '16') as HTMLElement
      );
      await user.click(within(dialog).getByRole('button', { name: 'ctaGenerate: count=1' }));

      await waitFor(async () =>
        expect(await bodiesOf(api, 'desk/previewBulk')).toEqual([
          { dates: ['2026-11-16'], userIds: ['user-viewer'], deskIds: ['desk-second'] },
        ])
      );
    });
  });

  it('refetches the directory when the socket comes back', async () => {
    mockRealtimeStatus = 'disconnected';
    const api = serve({ 'desk/directory': ok(directory([FREE])) });
    const client = createQueryClient();
    const tree = () => (
      <QueryClientProvider client={client}>
        <IntlProvider locale="cs" messages={cs}>
          <LocalizationProvider locale="cs-CZ">
            <DesksScreen />
          </LocalizationProvider>
        </IntlProvider>
      </QueryClientProvider>
    );
    const view = render(tree());
    await screen.findByRole('button', { name: /^deskAria/ });
    expect(await bodiesOf(api, 'desk/directory')).toHaveLength(1);

    mockRealtimeStatus = 'connected';
    view.rerender(tree());

    await waitFor(async () => expect(await bodiesOf(api, 'desk/directory')).toHaveLength(2));
    mockRealtimeStatus = 'connected';
  });
});
