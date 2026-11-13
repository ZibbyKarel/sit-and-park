import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createApiQueryUtils, type ApiQueryUtils } from '@garage/api-client';
import { IntlProvider } from '@garage/i18n';
import cs from '../../../../messages/cs.json';
import { createQueryClient } from '../../query/query-client';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  type StubbedApi,
  type StubbedResponse,
} from '../../../testing/stub-api';
import { T0 } from '../../../testing/fixtures';
import { selectOption } from '../../../test-utils/select-option';
import { AdminDeskStatsScreen } from './admin-desk-stats-screen';

jest.mock('@garage/i18n', () => ({
  ...jest.requireActual('@garage/i18n'),
  todayInPrague: () => '2026-11-16',
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('@garage/auth/client', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

let mockApi: ApiQueryUtils;
jest.mock('../../api-provider/api-provider', () => ({ useApi: () => mockApi }));

function serve(routes: Record<string, StubbedResponse>): StubbedApi {
  const api: StubbedApi = stubApi((index) => {
    const path = new URL(api.requests[index]?.url ?? '').pathname.replace(/^\/rpc\//, '');
    const response = routes[path];
    if (response === undefined) throw new Error(`unrouted call to ${path}`);
    return response;
  });
  mockApi = createApiQueryUtils(api.client);
  return api;
}

const ok = (value: unknown): StubbedResponse => ({ status: 200, body: rpcPayload(value) });

async function bodiesOf(api: StubbedApi, path: string): Promise<unknown[]> {
  return Promise.all(
    api.requests
      .filter((request) => request.url.endsWith(`/rpc/${path}`))
      .map(async (request) => ((await request.clone().json()) as { json: unknown }).json)
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <IntlProvider locale="cs" messages={cs}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  );
}

const office = (id: string, name: string) => ({
  id,
  name,
  active: true,
  floorPlan: null,
  floorPlanWidth: null,
  floorPlanHeight: null,
  createdAt: T0,
  updatedAt: T0,
  deskCount: 0,
  spotCount: 0,
  userCount: 0,
});

const STATS = {
  date: '2026-11-16',
  totalDesks: 12,
  activeDesks: 10,
  inactiveDesks: 2,
  permanentAssignments: 3,
  bookableOnDate: 8,
  reservedOnDate: 6,
  freeOnDate: 2,
  occupancyPercent: 75,
  hiveCount: 4,
  pendingApprovals: 5,
  byZone: [
    {
      zoneId: 'z1',
      zoneName: 'Zóna A',
      officeId: 'o1',
      desks: 7,
      free: 1,
      reserved: 4,
      unavailable: 2,
    },
    {
      zoneId: 'z2',
      zoneName: 'Zóna B',
      officeId: 'o2',
      desks: 5,
      free: 1,
      reserved: 2,
      unavailable: 2,
    },
  ],
  byOffice: [
    { officeId: 'o1', officeName: 'Praha', desks: 7, reservedOnDate: 4 },
    { officeId: 'o2', officeName: 'Brno', desks: 5, reservedOnDate: 2 },
  ],
};

const OFFICES = ok({ offices: [office('o1', 'Praha'), office('o2', 'Brno')] });

describe('AdminDeskStatsScreen', () => {
  it('renders every statistic as a tile, the occupancy bar, and both tables', async () => {
    const api = serve({ 'admin/office/list': OFFICES, 'admin/desk/stats': ok(STATS) });
    render(<AdminDeskStatsScreen />, { wrapper: Wrapper });

    const tile = async (label: string) =>
      (await screen.findByText(label)).closest('div') as HTMLElement;
    expect(within(await tile('tileOccupancy')).getByText('percent: value=75')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'tileOccupancy' })).toHaveAttribute(
      'aria-valuenow',
      '75'
    );
    for (const [label, value] of [
      ['tileBookable', '8'],
      ['tileReserved', '6'],
      ['tileFree', '2'],
      ['tileInactive', '2'],
      ['tilePermanent', '3'],
      ['tileHives', '4'],
      ['tilePending', '5'],
    ]) {
      expect(within(await tile(label as string)).getByText(value as string)).toBeInTheDocument();
    }

    // Two offices: the zone table names each zone's office.
    const zones = screen.getByRole('table', { name: 'zonesTitle' });
    expect(within(zones).getByRole('row', { name: /Zóna B.*Brno/ })).toBeInTheDocument();
    const offices = screen.getByRole('table', { name: 'officesTitle' });
    expect(within(offices).getByRole('row', { name: /Praha/ })).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/desk/stats')).toEqual([{ date: '2026-11-16' }]);
  });

  it('asks for one office when it is chosen', async () => {
    const api = serve({ 'admin/office/list': OFFICES, 'admin/desk/stats': ok(STATS) });
    const user = userEvent.setup();
    render(<AdminDeskStatsScreen />, { wrapper: Wrapper });

    await screen.findByText('tileOccupancy');
    await selectOption(user, 'officeFilter', 'Brno');

    await waitFor(async () =>
      expect((await bodiesOf(api, 'admin/desk/stats')).at(-1)).toEqual({
        date: '2026-11-16',
        officeId: 'o2',
      })
    );
  });

  it('shows a failed load as an error with retry', async () => {
    serve({ 'admin/office/list': OFFICES, 'admin/desk/stats': contractErrorResponse('NOT_FOUND') });
    render(<AdminDeskStatsScreen />, { wrapper: Wrapper });

    expect(await screen.findByText('NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });
});
