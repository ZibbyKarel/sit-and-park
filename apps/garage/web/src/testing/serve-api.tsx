/**
 * Specs of connected screens: a real `ApiClient` over a stubbed `fetch` that
 * answers by procedure path, wrapped in the providers the screens read.
 *
 * `useApi` is mocked in the spec itself (jest hoists `jest.mock`) to return
 * {@link servedApi}; this file holds everything else so the three admin
 * screens' specs do not each carry a copy.
 */

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { LocalizationProvider } from '@shoptet/ui';
import { createApiQueryUtils, type ApiQueryUtils } from '@garage/api-client';
import { IntlProvider } from '@garage/i18n';
import cs from '../../messages/cs.json';
import { createQueryClient } from '../shell/query/query-client';
import { ToastProvider } from '../shell/notifications/toast-provider';
import { rpcPayload, stubApi, type StubbedApi, type StubbedResponse } from './stub-api';

let served: ApiQueryUtils | undefined;

/** What the mocked `useApi` returns. */
export function servedApi(): ApiQueryUtils {
  if (served === undefined) throw new Error('serve() was not called');
  return served;
}

/** A 200 answer carrying `value`. */
export const ok = (value: unknown): StubbedResponse => ({ status: 200, body: rpcPayload(value) });

/** Answers by procedure path (`admin/hive/list`); an unrouted call fails loudly. */
export function serve(routes: Record<string, StubbedResponse>): StubbedApi {
  const api: StubbedApi = stubApi((index) => {
    const path = new URL(api.requests[index]?.url ?? '').pathname.replace(/^\/rpc\//u, '');
    const response = routes[path];
    if (response === undefined) throw new Error(`unrouted call to ${path}`);
    return response;
  });
  served = createApiQueryUtils(api.client);
  return api;
}

/** The JSON bodies sent to one procedure, oldest first. */
export async function bodiesOf(api: StubbedApi, path: string): Promise<unknown[]> {
  const matching = api.requests.filter((request) => request.url.endsWith(`/rpc/${path}`));
  return Promise.all(
    matching.map(async (request) => ((await request.clone().json()) as { json: unknown }).json)
  );
}

export function ServedProviders({ children }: { children: ReactNode }) {
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
