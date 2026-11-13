import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { LocalizationProvider } from '@shoptet/ui';
import { createApiQueryUtils, type ApiQueryUtils } from '@sit-and-park/api-client';
import { IntlProvider } from '@sit-and-park/i18n';
import cs from '../../../messages/cs.json';
import { createQueryClient } from '../../shell/query/query-client';
import { ToastProvider } from '../../shell/notifications/toast-provider';
import { selectOption } from '../../test-utils/select-option';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  transportErrorResponse,
  type StubbedApi,
  type StubbedResponse,
} from '../../testing/stub-api';
import { profile, T0 } from '../../testing/fixtures';
import { D1, D2, D3, preview } from './desk-bulk.test-helpers';
import { DeskBulkModal, type DeskBulkModalProps } from './desk-bulk-modal';

const ANCHOR = '2026-11-16';

jest.mock('@sit-and-park/i18n', () => ({
  ...jest.requireActual('@sit-and-park/i18n'),
  todayInPrague: () => '2026-11-16',
}));
jest.mock('@sit-and-park/auth/client', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));
let mockApi: ApiQueryUtils;
jest.mock('../../shell/api-provider/api-provider', () => ({ useApi: () => mockApi }));

const ok = (value: unknown): StubbedResponse => ({ status: 200, body: rpcPayload(value) });

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

function renderModal(props: Partial<DeskBulkModalProps> = {}) {
  const onClose = jest.fn();
  const element = (extra: Partial<DeskBulkModalProps>) => (
    <DeskBulkModal
      onClose={onClose}
      anchorDate={ANCHOR}
      isAdmin={false}
      viewerUserId="user-viewer"
      {...props}
      {...extra}
    />
  );
  const view = render(element({}), { wrapper: Wrapper });
  return {
    user: userEvent.setup(),
    onClose,
    rerender: (extra: Partial<DeskBulkModalProps>) => view.rerender(element(extra)),
  };
}

/** The day tile with this number (a business day of the grid). */
function dayTile(day: number): HTMLElement {
  const tile = screen
    .getAllByRole('button')
    .find(
      (button) =>
        button.textContent === String(day) &&
        /^dayCell/.test(button.getAttribute('aria-label') ?? '')
    );
  if (tile === undefined) throw new Error(`no selectable tile for day ${day}`);
  return tile;
}

const reservation = (userId: string, date: string, deskId: string) => ({
  id: `res-${userId}-${date}`,
  deskId,
  userId,
  date,
  createdAt: T0,
});

const USERS = {
  users: [
    profile({ id: 'user-viewer', name: 'Karel Zíbar' }),
    profile({ id: 'user-jana', name: 'Jana Nováková' }),
  ],
};

/** Opens the people MultiSelect, toggles `name` and closes the popover. */
async function togglePerson(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByLabelText('peopleLegend'));
  await user.click(await screen.findByRole('option', { name }));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('DeskBulkModal', () => {
  it('marks only today in the grid', () => {
    serve({});
    renderModal();

    expect(dayTile(16)).toHaveAttribute('data-today');
    expect(dayTile(17)).not.toHaveAttribute('data-today');
  });

  it('USER: picks days, sends no people, books the proposal and reports the result', async () => {
    const api = serve({
      'desk/previewBulk': ok(
        preview({
          people: preview().people.slice(0, 1),
          rows: preview().rows.slice(0, 2),
        })
      ),
      'desk/confirmBulk': ok({
        reserved: [reservation('user-viewer', '2026-11-16', D1.id)],
        skipped: [],
      }),
      'desk/key': ok({}),
    });
    const { user } = renderModal();

    expect(screen.queryByText('peopleLegend')).not.toBeInTheDocument();
    await user.click(dayTile(16));
    await user.click(dayTile(18));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=2' }));

    expect(await screen.findByText('preferredTag')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/previewBulk')).toEqual([
      { dates: ['2026-11-16', '2026-11-18'] },
    ]);
    // The unassigned Tuesday is not sent.
    await user.click(screen.getByRole('button', { name: 'ctaConfirm: count=1' }));

    expect(await screen.findByText('resultBooked: count=1')).toBeInTheDocument();
    expect(screen.getByText('resultAllAsProposed')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/confirmBulk')).toEqual([
      { assignments: [{ userId: 'user-viewer', date: '2026-11-16', deskId: D1.id }] },
    ]);
  });

  it('ADMIN: books for two people and shows the translated reason of an unavailable row', async () => {
    const api = serve({
      'admin/user/list': ok(USERS),
      'desk/previewBulk': ok(preview()),
      'desk/confirmBulk': ok({ reserved: [], skipped: [] }),
    });
    const { user } = renderModal({ isAdmin: true });

    await togglePerson(user, 'Jana Nováková');
    await user.click(dayTile(16));
    await user.click(dayTile(18));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=2' }));

    expect(await screen.findByText('skipPermanentHolder')).toBeInTheDocument();
    expect(await bodiesOf(api, 'desk/previewBulk')).toEqual([
      { dates: ['2026-11-16', '2026-11-18'], userIds: ['user-viewer', 'user-jana'] },
    ]);
  });

  it('ADMIN: deselecting everyone disables generate', async () => {
    serve({ 'admin/user/list': ok(USERS) });
    const { user } = renderModal({ isAdmin: true });

    await togglePerson(user, 'Karel Zíbar');
    await user.click(dayTile(16));
    expect(screen.getByRole('button', { name: 'ctaGenerate: count=1' })).toBeDisabled();
  });

  it('non-admin: the desk select is disabled', async () => {
    serve({ 'desk/previewBulk': ok(preview()) });
    const { user } = renderModal({ isAdmin: false });
    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await screen.findByText('preferredTag');
    expect(screen.getByLabelText(/deskSelectLabel: person=Jana.*16\. listopadu/)).toBeDisabled();
  });

  it('manual pick on an UNASSIGNED row is sent, and the desk disappears from the others', async () => {
    const api = serve({
      'admin/user/list': ok(USERS),
      'desk/previewBulk': ok(preview()),
      'desk/confirmBulk': ok({
        reserved: [reservation('user-jana', '2026-11-16', D2.id)],
        skipped: [],
      }),
    });
    const { user } = renderModal({ isAdmin: true });

    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await screen.findByText('preferredTag');

    await selectOption(user, /deskSelectLabel: person=Jana.*16\. listopadu/, 'D-002 · Zóna A');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    // Karel's row on the same day no longer offers D-002.
    await user.click(screen.getByLabelText(/deskSelectLabel: person=Karel.*16\. listopadu/));
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['noDesk', 'D-001 · Zóna A', 'D-003 · Zóna B']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'ctaConfirm: count=2' }));
    await screen.findByText('resultBooked: count=1');
    const [body] = (await bodiesOf(api, 'desk/confirmBulk')) as {
      assignments: { userId: string; deskId: string }[];
    }[];
    expect(body?.assignments).toContainEqual({
      userId: 'user-jana',
      date: '2026-11-16',
      deskId: D2.id,
    });
  });

  it('result step compares: a skipped row is listed with its reason and flagged as changed', async () => {
    serve({
      'desk/previewBulk': ok(preview({ rows: preview().rows.slice(0, 1) })),
      'desk/confirmBulk': ok({
        reserved: [],
        skipped: [
          { userId: 'user-viewer', date: '2026-11-16', deskId: D1.id, reason: 'DESK_TAKEN' },
        ],
      }),
    });
    const { user } = renderModal();

    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await user.click(await screen.findByRole('button', { name: 'ctaConfirm: count=1' }));

    expect(await screen.findByText('resultNothingBooked')).toBeInTheDocument();
    expect(screen.getByText('skipDeskTaken', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('resultChangedDescription')).toBeInTheDocument();
  });

  it('passes the pre-selected desks as the candidate pool and says so', async () => {
    const api = serve({ 'desk/previewBulk': ok(preview()) });
    const { user } = renderModal({ isAdmin: false, deskIds: [D1.id, D3.id] });

    expect(screen.getByText('poolNote: count=2')).toBeInTheDocument();
    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'desk/previewBulk')).toEqual([
        { dates: ['2026-11-16'], deskIds: [D1.id, D3.id] },
      ])
    );
  });

  it('CONFLICT: shows "try again" and stays on the schedule', async () => {
    serve({
      'desk/previewBulk': ok(preview({ rows: preview().rows.slice(0, 1) })),
      'desk/confirmBulk': contractErrorResponse('CONFLICT'),
    });
    const { user } = renderModal();

    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await user.click(await screen.findByRole('button', { name: 'ctaConfirm: count=1' }));

    expect(await screen.findByText('errorConflict')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ctaConfirm: count=1' })).toBeEnabled();
  });

  it('ADMIN whose profile loads after opening: the viewer is selected once known', async () => {
    const api = serve({
      'admin/user/list': ok(USERS),
      'desk/previewBulk': ok(preview()),
    });
    const { user, rerender } = renderModal({ isAdmin: true, viewerUserId: null });
    const trigger = await screen.findByLabelText('peopleLegend');
    expect(trigger).not.toHaveTextContent('Karel Zíbar');
    rerender({ viewerUserId: 'user-viewer' });
    expect(trigger).toHaveTextContent('Karel Zíbar');

    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await waitFor(async () => {
      expect(await bodiesOf(api, 'desk/previewBulk')).toEqual([
        { dates: ['2026-11-16'], userIds: ['user-viewer'] },
      ]);
    });
  });

  it('unknown confirm error: warns that some may be booked and still refreshes desk queries', async () => {
    const api = serve({
      'desk/previewBulk': ok(preview({ rows: preview().rows.slice(0, 1) })),
      'desk/confirmBulk': transportErrorResponse(500, 'boom'),
      'desk/key': ok({}),
    });
    const { user } = renderModal();

    await user.click(dayTile(16));
    await user.click(screen.getByRole('button', { name: 'ctaGenerate: count=1' }));
    await user.click(await screen.findByRole('button', { name: 'ctaConfirm: count=1' }));

    expect(await screen.findByText('errorUnknownConfirm')).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith('/rpc/desk/confirmBulk'))).toBe(
      true
    );
  });
});
