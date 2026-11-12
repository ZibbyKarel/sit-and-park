import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminHive, AdminUser } from '@garage/contract';
import { selectOption } from '../../../test-utils/select-option';
import { contractErrorResponse } from '../../../testing/stub-api';
import { bodiesOf, ok, serve, ServedProviders } from '../../../testing/serve-api';
import { AdminHivesScreen } from './admin-hives-screen';

jest.mock('@garage/auth/client', () => ({
  useRequireAuth: () => ({ status: 'authenticated' }),
}));
jest.mock('../../api-provider/api-provider', () => ({
  useApi: () => jest.requireActual('../../../testing/serve-api').servedApi(),
}));

const T = '2026-01-01T00:00:00.000Z';

function user(id: string, name: string): AdminUser {
  return {
    id,
    name,
    email: `${id}@firma.cz`,
    licensePlate: null,
    role: 'USER',
    oktaId: id,
    active: true,
    preferredParkingSpotId: null,
    officeId: 'office-1',
    hibobId: null,
    manualAccount: false,
    deactivatedAt: null,
    createdAt: T,
    updatedAt: T,
  };
}

function hive(
  id: string,
  name: string,
  owner: AdminUser,
  members: AdminUser[],
  deskCount = 0
): AdminHive {
  return {
    id,
    name,
    color: '#3366ff',
    ownerId: owner.id,
    ownerName: owner.name,
    createdAt: T,
    updatedAt: T,
    deskCount,
    members: members.map((member) => ({ userId: member.id, name: member.name })),
  };
}

const ADELA = user('u-1', 'Adéla Horáková');
const BARA = user('u-2', 'Bára Nová');
const CENEK = user('u-4', 'Čeněk Svoboda');
const DANA = user('u-5', 'Dana Krátká');
const ENGINEERING = hive('h-1', 'Engineering', ADELA, [BARA], 12);
const SUPPORT = hive('h-2', 'Support', ADELA, [CENEK], 3);

function routes(extra: Record<string, ReturnType<typeof ok>> = {}) {
  return {
    'admin/hive/list': ok({ hives: [ENGINEERING, SUPPORT] }),
    'admin/user/list': ok({ users: [ADELA, BARA, CENEK, DANA] }),
    ...extra,
  };
}

function renderScreen() {
  render(<AdminHivesScreen />, { wrapper: ServedProviders });
  return userEvent.setup();
}

function rowOf(hive: AdminHive): HTMLElement {
  const row = document.querySelector(`[data-row-id="${hive.id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${hive.name}`);
  return row;
}

describe('AdminHivesScreen', () => {
  it('lists each hive with its owner, member count and desk count', async () => {
    serve(routes());
    renderScreen();

    await screen.findByText('Engineering');
    const row = within(rowOf(ENGINEERING));
    expect(row.getByText('Adéla Horáková')).toBeInTheDocument();
    expect(row.getByText('1')).toBeInTheDocument();
    expect(row.getByText('12')).toBeInTheDocument();
  });

  it('creates a hive from a name, a colour and an owner', async () => {
    const api = serve(routes({ 'admin/hive/create': ok(ENGINEERING) }));
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'add' }));
    const dialog = within(screen.getByRole('dialog'));
    await u.type(dialog.getByLabelText('nameField'), 'Sales');
    await u.clear(dialog.getByLabelText('colorField'));
    await u.type(dialog.getByLabelText('colorField'), '#ff8800');
    await selectOption(u, 'ownerField', 'Bára Nová');
    await u.click(dialog.getByRole('button', { name: 'save' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/hive/create')).toEqual([
        { name: 'Sales', color: '#ff8800', ownerId: 'u-2' },
      ])
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and says why when the name is taken', async () => {
    serve(routes({ 'admin/hive/create': contractErrorResponse('CONFLICT') }));
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'add' }));
    const dialog = within(screen.getByRole('dialog'));
    await u.type(dialog.getByLabelText('nameField'), 'Engineering');
    await selectOption(u, 'ownerField', 'Bára Nová');
    await u.click(dialog.getByRole('button', { name: 'save' }));

    expect(await dialog.findByText('errHiveConflict')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks before moving a member out of another hive, naming both', async () => {
    const api = serve(routes({ 'admin/hive/setMembership': ok({ userId: 'u-4', hiveId: 'h-1' }) }));
    const u = renderScreen();

    await screen.findByText('Engineering');
    await u.click(within(rowOf(ENGINEERING)).getByRole('button', { name: 'members' }));
    await selectOption(u, 'memberAddField', 'memberOption: name=Čeněk Svoboda,hive=Support');
    await u.click(screen.getByRole('button', { name: 'memberAdd' }));

    expect(
      await screen.findByText('moveDescription: name=Čeněk Svoboda,from=Support,to=Engineering')
    ).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/hive/setMembership')).toEqual([]);

    await u.click(screen.getByRole('button', { name: 'moveConfirm' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/hive/setMembership')).toEqual([
        { hiveId: 'h-1', userId: 'u-4', member: true },
      ])
    );
  });

  it('adds a user who is in no hive without asking', async () => {
    const api = serve(routes({ 'admin/hive/setMembership': ok({ userId: 'u-5', hiveId: 'h-1' }) }));
    const u = renderScreen();

    await screen.findByText('Engineering');
    await u.click(within(rowOf(ENGINEERING)).getByRole('button', { name: 'members' }));
    await selectOption(u, 'memberAddField', 'Dana Krátká');
    await u.click(screen.getByRole('button', { name: 'memberAdd' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/hive/setMembership')).toEqual([
        { hiveId: 'h-1', userId: 'u-5', member: true },
      ])
    );
    expect(screen.queryByText(/^moveDescription/u)).not.toBeInTheDocument();
  });

  it('removes a member', async () => {
    const api = serve(routes({ 'admin/hive/setMembership': ok({ userId: 'u-2', hiveId: null }) }));
    const u = renderScreen();

    await screen.findByText('Engineering');
    await u.click(within(rowOf(ENGINEERING)).getByRole('button', { name: 'members' }));
    await u.click(await screen.findByRole('button', { name: 'memberRemove: name=Bára Nová' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/hive/setMembership')).toEqual([
        { hiveId: 'h-1', userId: 'u-2', member: false },
      ])
    );
  });

  it('says what deleting does, and deletes only on confirmation', async () => {
    const api = serve(routes({ 'admin/hive/delete': ok({ hiveId: 'h-2' }) }));
    const u = renderScreen();

    await screen.findByText('Support');
    await u.click(within(rowOf(SUPPORT)).getByRole('button', { name: 'delete' }));

    expect(await screen.findByText('deleteDescription')).toBeInTheDocument();
    expect(await bodiesOf(api, 'admin/hive/delete')).toEqual([]);

    await u.click(screen.getByRole('button', { name: 'deleteConfirm' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/hive/delete')).toEqual([{ hiveId: 'h-2' }])
    );
  });
});
