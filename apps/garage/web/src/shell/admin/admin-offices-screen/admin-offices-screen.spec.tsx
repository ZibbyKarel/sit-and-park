import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminOffice, Zone } from '@garage/contract';
import { contractErrorResponse } from '../../../testing/stub-api';
import { bodiesOf, ok, serve, ServedProviders } from '../../../testing/serve-api';
import { AdminOfficesScreen } from './admin-offices-screen';

jest.mock('@garage/auth/client', () => ({
  useRequireAuth: () => ({ status: 'authenticated' }),
}));
jest.mock('../../api-provider/api-provider', () => ({
  useApi: () => jest.requireActual('../../../testing/serve-api').servedApi(),
}));

const T = '2026-01-01T00:00:00.000Z';

const PRAHA: AdminOffice = {
  id: 'o-1',
  name: 'Praha',
  active: true,
  floorPlan: null,
  floorPlanWidth: null,
  floorPlanHeight: null,
  createdAt: T,
  updatedAt: T,
  deskCount: 40,
  spotCount: 15,
  userCount: 120,
};
const BRNO: AdminOffice = { ...PRAHA, id: 'o-2', name: 'Brno', active: false, deskCount: 5 };
const ZONE: Zone = { id: 'z-1', officeId: 'o-1', key: 'engineering1', name: 'Vývoj' };

function renderScreen() {
  render(<AdminOfficesScreen />, { wrapper: ServedProviders });
  return userEvent.setup();
}

function rowOf(office: AdminOffice): HTMLElement {
  const row = document.querySelector(`[data-row-id="${office.id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${office.name}`);
  return row;
}

const listing = () => ({ 'admin/office/list': ok({ offices: [PRAHA, BRNO] }) });

describe('AdminOfficesScreen', () => {
  it('lists offices with their counts and marks an inactive one', async () => {
    serve(listing());
    renderScreen();

    await screen.findByText('Praha');
    const row = within(rowOf(PRAHA));
    expect(row.getByText('40')).toBeInTheDocument();
    expect(row.getByText('15')).toBeInTheDocument();
    expect(row.getByText('120')).toBeInTheDocument();
    expect(within(rowOf(BRNO)).getByText('inactive')).toBeInTheDocument();
  });

  it('creates an office, active by default', async () => {
    const api = serve({ ...listing(), 'admin/office/create': ok(PRAHA) });
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'add' }));
    const dialog = within(screen.getByRole('dialog'));
    await u.type(dialog.getByLabelText('nameField'), 'Ostrava');
    await u.click(dialog.getByRole('button', { name: 'save' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/office/create')).toEqual([
        { name: 'Ostrava', active: true },
      ])
    );
  });

  it('keeps the dialog open and says why when the name is taken', async () => {
    serve({ ...listing(), 'admin/office/create': contractErrorResponse('CONFLICT') });
    const u = renderScreen();

    await u.click(await screen.findByRole('button', { name: 'add' }));
    const dialog = within(screen.getByRole('dialog'));
    await u.type(dialog.getByLabelText('nameField'), 'Praha');
    await u.click(dialog.getByRole('button', { name: 'save' }));

    expect(await dialog.findByText('errOfficeConflict')).toBeInTheDocument();
  });

  it('switches an office off from its edit dialog', async () => {
    const api = serve({ ...listing(), 'admin/office/update': ok(PRAHA) });
    const u = renderScreen();

    await screen.findByText('Praha');
    await u.click(within(rowOf(PRAHA)).getByRole('button', { name: 'edit' }));
    const dialog = within(screen.getByRole('dialog'));
    await u.click(dialog.getByRole('checkbox', { name: 'activeField' }));
    await u.click(dialog.getByRole('button', { name: 'save' }));

    await waitFor(async () =>
      expect(await bodiesOf(api, 'admin/office/update')).toEqual([
        { officeId: 'o-1', name: 'Praha', active: false },
      ])
    );
  });

  describe('zones', () => {
    const zones = () => ({
      ...listing(),
      'admin/zone/list': ok({ zones: [ZONE] }),
    });

    it('lists the office’s zones', async () => {
      const api = serve(zones());
      const u = renderScreen();

      await screen.findByText('Praha');
      await u.click(within(rowOf(PRAHA)).getByRole('button', { name: 'zones' }));

      expect(await screen.findByText('Vývoj')).toBeInTheDocument();
      expect(await bodiesOf(api, 'admin/zone/list')).toEqual([{ officeId: 'o-1' }]);
    });

    it('adds a zone with a key and a name', async () => {
      const api = serve({ ...zones(), 'admin/zone/create': ok(ZONE) });
      const u = renderScreen();

      await screen.findByText('Praha');
      await u.click(within(rowOf(PRAHA)).getByRole('button', { name: 'zones' }));
      const dialog = within(await screen.findByRole('dialog'));
      await u.type(dialog.getByLabelText('zoneKeyField'), 'sales');
      await u.type(dialog.getByLabelText('zoneNameField'), 'Obchod');
      await u.click(dialog.getByRole('button', { name: 'zoneAdd' }));

      await waitFor(async () =>
        expect(await bodiesOf(api, 'admin/zone/create')).toEqual([
          { officeId: 'o-1', key: 'sales', name: 'Obchod' },
        ])
      );
    });

    it('says a key is taken instead of a generic failure', async () => {
      serve({ ...zones(), 'admin/zone/create': contractErrorResponse('CONFLICT') });
      const u = renderScreen();

      await screen.findByText('Praha');
      await u.click(within(rowOf(PRAHA)).getByRole('button', { name: 'zones' }));
      const dialog = within(await screen.findByRole('dialog'));
      await u.type(dialog.getByLabelText('zoneKeyField'), 'engineering1');
      await u.type(dialog.getByLabelText('zoneNameField'), 'Duplicita');
      await u.click(dialog.getByRole('button', { name: 'zoneAdd' }));

      expect(await dialog.findByText('errZoneConflict')).toBeInTheDocument();
    });

    it('renames a zone, leaving the key alone', async () => {
      const api = serve({ ...zones(), 'admin/zone/update': ok(ZONE) });
      const u = renderScreen();

      await screen.findByText('Praha');
      await u.click(within(rowOf(PRAHA)).getByRole('button', { name: 'zones' }));
      const dialog = within(await screen.findByRole('dialog'));
      await u.click(await dialog.findByRole('button', { name: 'zoneRename: name=Vývoj' }));
      expect(dialog.getByLabelText('zoneKeyField')).toBeDisabled();
      await u.clear(dialog.getByLabelText('zoneNameField'));
      await u.type(dialog.getByLabelText('zoneNameField'), 'Vývoj 2');
      await u.click(dialog.getByRole('button', { name: 'zoneSave' }));

      await waitFor(async () =>
        expect(await bodiesOf(api, 'admin/zone/update')).toEqual([
          { zoneId: 'z-1', name: 'Vývoj 2' },
        ])
      );
    });
  });
});
