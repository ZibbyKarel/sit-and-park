/**
 * `POST /api/employee-sync` through the assembled application: the route is
 * public (no Okta token), the key check answers 401, the body limit for this
 * path alone is 2 MB, and the bearer key never reaches the log.
 *
 * Nothing here gets past the key check, so no database is needed; the runs
 * themselves are covered by `employee-sync.db.spec.ts`.
 */

import { createHash } from 'node:crypto';
import { EMPLOYEE_SYNC_PATH } from '@garage/contract';
import type { OidcTestIssuer } from '../auth/testing/oidc-test-issuer';
import { createSigningKey, startOidcTestIssuer } from '../auth/testing/oidc-test-issuer';
import { PrismaDouble } from '../testing/prisma-double';
import type { ApiTestApp } from '../testing/nest-test-app';
import { startApiTestApp } from '../testing/nest-test-app';

const KEY = 'the-right-key-which-is-long-enough-0123456789';
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');

describe('POST /api/employee-sync through the assembled application', () => {
  let harness: ApiTestApp;
  let issuer: OidcTestIssuer;
  const logLines: string[] = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    issuer = await startOidcTestIssuer([createSigningKey('key-1')]);
    harness = await startApiTestApp({
      issuer,
      store: new PrismaDouble(),
      env: { EMPLOYEE_SYNC_KEY_SHA256: KEY_HASH },
      logLevel: 'info',
      onLogLine: (line) => logLines.push(line),
    });
  });

  afterAll(async () => {
    await harness?.close();
    await issuer?.close();
    process.env = originalEnv;
  });

  function post(body: string, authorization?: string): Promise<Response> {
    return fetch(`${harness.baseUrl}${EMPLOYEE_SYNC_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization === undefined ? {} : { authorization }),
      },
      body,
    });
  }

  const LIST = JSON.stringify({ employees: [{ id: '1', email: 'a@team.blue', name: 'A' }] });

  it.each([
    ['no Authorization header', undefined],
    ['a wrong key', `Bearer ${'x'.repeat(40)}`],
    ['a key shorter than 32 characters', 'Bearer short'],
    ['the right key without the Bearer scheme', KEY],
  ])('answers 401 to %s', async (_label, authorization) => {
    const response = await post(LIST, authorization);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      reason: expect.stringMatching(/^INVALID_KEY: /),
    });
  });

  it('accepts a body above the global 100 kb limit on this path', async () => {
    const employees = Array.from({ length: 12_000 }, (_, i) => ({
      id: String(i),
      email: `person${i}@team.blue`,
      name: `Person ${i}`,
    }));
    const body = JSON.stringify({ employees });
    expect(body.length).toBeGreaterThan(500_000);

    // Past the parser, stopped at the key check.
    expect((await post(body, 'Bearer wrong')).status).toBe(401);
  });

  it('answers 413 above 2 MB', async () => {
    const body = JSON.stringify({ employees: [], padding: 'x'.repeat(2_200_000) });

    expect((await post(body, `Bearer ${KEY}`)).status).toBe(413);
  });

  it('answers 400 to malformed JSON', async () => {
    expect((await post('{"employees": [', `Bearer ${KEY}`)).status).toBe(400);
  });

  it('never logs the key', async () => {
    await post(LIST, `Bearer ${KEY}x`);
    const deadline = Date.now() + 2_000;
    while (!logLines.some((line) => line.includes(EMPLOYEE_SYNC_PATH)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(logLines.some((line) => line.includes(EMPLOYEE_SYNC_PATH))).toBe(true);
    expect(logLines.join('')).not.toContain(KEY);
  });
});
