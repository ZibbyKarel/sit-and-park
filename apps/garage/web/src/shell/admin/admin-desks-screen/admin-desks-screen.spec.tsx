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
import { adminDesk } from './admin-desk.test-helpers';
import { AdminDesksScreen } from './admin-desks-screen';

/** The connected screen over a real `ApiClient` with a stubbed `fetch`; only the session, router and API provider are doubled. */

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

type Routes = Record<string, StubbedResponse>;

function serve(routes: Routes): StubbedApi {
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
  const matching = api.requests.filter((request) => request.url.endsWith(`/rpc/${path}`));
  return Promise.all(
    matching.map(async (request) => ((await request.clone().json()) as { json: unknown }).json)
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

const OFFICE = {
  id: 'office-1',
  name: 'Praha',
  active: true,
  floorPlan: 'praha',
  floorPlanWidth: 22473,
  floorPlanHeight: 5835,
  createdAt: T0,
  updatedAt: T0,
  deskCount: 3,
  spotCount: 0,
  userCount: 2,
};
const HIVE = {
  id: 'hive-1',
  name: 'Engineering',
  color: '#3366FF',
  ownerId: 'user-eva',
  createdAt: T0,
  updatedAt: T0,
  ownerName: 'Eva',
  members: [],
  deskCount: 0,
};
function user(id: string, name: string, officeId: string | null = 'office-1') {
  return {
    id,
    email: `${id}@example.test`,
    name,
    licensePlate: null,
    role: 'USER',
    oktaId: `okta-${id}`,
    active: true,
    preferredParkingSpotId: null,
    officeId,
    hibobId: null,
    manualAccount: false,
    deactivatedAt: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

const D1 = adminDesk({ id: 'd1', code: 'D-001', zoneId: 'zone-a', zoneName: 'Zóna A' });
const D2 = adminDesk({ id: 'd2', code: 'D-002', zoneId: 'zone-a', zoneName: 'Zóna A' });
const D3 = adminDesk({
  id: 'd3',
  code: 'D-003',
  zoneId: 'zone-b',
  zoneName: 'Zóna B',
  status: 'ASSIGNED',
  permanentAssigneeId: 'u-eva',
  permanentAssigneeName: 'Eva Nová',
});

/** The reads every test needs; a test adds the writes it exercises. */
function base(overrides: Routes = {}): Routes {
  return {
    'admin/office/list': ok({ offices: [OFFICE] }),
    'admin/hive/list': ok({ hives: [HIVE] }),
    'admin/user/list': ok({
      users: [
        user('u-eva', 'Eva Nová'),
        user('u-petr', 'Petr Dvořák'),
        user('u-x', 'Jiná', 'office-2'),
      ],
    }),
    'admin/desk/list': ok({ date: '2026-11-16', desks: [D1, D2, D3] }),
    'admin/zone/list': ok({
      zones: [{ id: 'zone-a', officeId: 'office-1', key: 'a', name: 'Zóna A' }],
    }),
    'admin/desk/grants': ok({ grants: [] }),
    ...overrides,
  };
}

function renderScreen() {
  render(<AdminDesksScreen />, { wrapper: Wrapper });
  return userEvent.setup();
}

const planButton = (code: string) =>
  screen.findByRole('button', { name: new RegExp(`^deskAria(Hive)?: code=${code},`) });

describe('AdminDesksScreen', () => {
  it('lists the first office’s desks for the day on the plan, toned by status', async () => {
    const api = serve(base());
    renderScreen();

    expect(await planButton('D-001')).toHaveAccessibleName(
      'deskAria: code=D-001,status=statusFree'
    );
    expect(
      screen.getByRole('button', { name: /code=D-003,status=statusAssigned/ })
    ).toBeInTheDocument();
    expect(screen.getByText('nothingSelected')).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/desk/list')).toEqual([
      { date: '2026-11-16', officeId: 'office-1' },
    ]);
  });

  it('selects one desk, deactivates it after confirming what it cancels, and reloads', async () => {
    const api = serve(base({ 'admin/desk/update': ok({ ...D1, active: false }) }));
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    expect(await screen.findByText('editorTitle: code=D-001')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'activeToggle' }));
    await user.click(screen.getByRole('button', { name: 'save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('impactCancels')).toBeInTheDocument();
    expect(within(dialog).getByText('impactRejects')).toBeInTheDocument();
    // Nothing is sent before the admin confirms.
    expect(await bodiesOf(api, 'admin/desk/update')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'confirmApply' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/desk/update')).toEqual([{ deskId: 'd1', active: false }])
    );
    await waitFor(async () => expect(await bodiesOf(api, 'admin/desk/list')).toHaveLength(2));
  });

  it('a hive change warns only about requests, and cancelling sends nothing', async () => {
    const api = serve(base());
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await selectOption(user, 'fieldHive', 'Engineering');
    await user.click(screen.getByRole('button', { name: 'save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('impactRejects')).toBeInTheDocument();
    expect(within(dialog).queryByText('impactCancels')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'confirmCancel' }));

    expect(await bodiesOf(api, 'admin/desk/update')).toEqual([]);
  });

  it('Ctrl+click adds a second desk and the panel switches to the bulk editor', async () => {
    const api = serve(base({ 'admin/desk/bulkUpdate': ok({ updated: 2 }) }));
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await user.keyboard('{Control>}');
    await user.click(await planButton('D-002'));
    await user.keyboard('{/Control}');

    expect(await screen.findByText('bulkTitle: count=2')).toBeInTheDocument();
    await selectOption(user, 'bulkActiveField', 'bulkDeactivate');
    await user.click(screen.getByRole('button', { name: 'bulkApply' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('impactCancels')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'confirmApply' }));

    expect(await screen.findByText('bulkUpdated: count=2')).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/desk/bulkUpdate')).toEqual([
      { deskIds: ['d1', 'd2'], active: false },
    ]);
  });

  it('the table is the accessible alternative: checkboxes select, "select the zone" adds a zone', async () => {
    serve(base());
    const user = renderScreen();

    await user.click(await screen.findByRole('tab', { name: 'viewList' }));
    await user.click(screen.getByRole('checkbox', { name: 'selectDesk: code=D-003' }));
    expect(await screen.findByText('editorTitle: code=D-003')).toBeInTheDocument();

    await selectOption(user, 'zoneFilter', 'Zóna A');
    await user.click(screen.getByRole('button', { name: 'selectZone' }));

    expect(await screen.findByText('bulkTitle: count=3')).toBeInTheDocument();
    expect(screen.getByText('selectedCount: count=3,total=3')).toBeInTheDocument();
  });

  it('makes a user of the desk’s office the permanent holder (other offices are not offered)', async () => {
    const api = serve(base({ 'admin/desk/setPermanentAssignee': ok(D1) }));
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await user.click(await screen.findByLabelText('holderField'));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'holderNone',
      'Eva Nová (u-eva@example.test)',
      'Petr Dvořák (u-petr@example.test)',
    ]);
    await user.click(options[2] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'holderSave' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/desk/setPermanentAssignee')).toEqual([
        { deskId: 'd1', userId: 'u-petr' },
      ])
    );
  });

  it('adds a direct grant and removes an existing one', async () => {
    const api = serve(
      base({
        'admin/desk/grants': ok({
          grants: [{ userId: 'u-eva', name: 'Eva Nová', email: 'u-eva@example.test' }],
        }),
        'admin/desk/setGrant': ok({ updated: 1 }),
      })
    );
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await user.click(await screen.findByRole('button', { name: 'grantRemoveFor: name=Eva Nová' }));
    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/desk/setGrant')).toEqual([
        { deskIds: ['d1'], userId: 'u-eva', granted: false },
      ])
    );

    await selectOption(user, 'grantUserField', /Petr Dvořák/);
    await user.click(screen.getByRole('button', { name: 'grantAdd' }));
    await waitFor(async () =>
      expect((await bodiesOf(api, 'admin/desk/setGrant')).at(-1)).toEqual({
        deskIds: ['d1'],
        userId: 'u-petr',
        granted: true,
      })
    );
  });

  it('bulk-grants one user and shows the count the API returns', async () => {
    const api = serve(base({ 'admin/desk/setGrant': ok({ updated: 2 }) }));
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await user.keyboard('{Control>}');
    await user.click(await planButton('D-002'));
    await user.keyboard('{/Control}');
    await selectOption(user, 'grantUserField', /Eva Nová/);
    await user.click(screen.getByRole('button', { name: 'bulkGrant' }));

    expect(await screen.findByText('grantsChanged: count=2')).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/desk/setGrant')).toEqual([
      { deskIds: ['d1', 'd2'], userId: 'u-eva', granted: true },
    ]);
  });

  it('shows a contract error as the operation’s own sentence', async () => {
    serve(base({ 'admin/desk/update': contractErrorResponse('CONFLICT') }));
    const user = renderScreen();

    await user.click(await planButton('D-001'));
    await user.click(screen.getByRole('switch', { name: 'activeToggle' }));
    await user.click(screen.getByRole('button', { name: 'save' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'confirmApply' })
    );

    expect(await screen.findByText('errUpdateConflict')).toBeInTheDocument();
  });
});
