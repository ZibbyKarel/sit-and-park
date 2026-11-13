import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { EmployeeSyncController } from './employee-sync.controller';
import type { EmployeeSyncResult, EmployeeSyncService } from './employee-sync.service';
import { isValidEmployeeSyncKey } from './employee-sync-key';

const KEY = 'k'.repeat(32);
const HASH = createHash('sha256').update(KEY).digest('hex');

describe('isValidEmployeeSyncKey', () => {
  it('accepts exactly `Bearer <key>` whose SHA-256 matches', () => {
    expect(isValidEmployeeSyncKey(`Bearer ${KEY}`, HASH)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['another scheme', `Basic ${KEY}`],
    ['the bare key', KEY],
    ['a wrong key', `Bearer ${'j'.repeat(32)}`],
    ['the right hash of a key shorter than 32', 'Bearer short'],
    ['trailing garbage', `Bearer ${KEY} extra`],
  ])('refuses %s', (_label, header) => {
    const hash =
      header === 'Bearer short' ? createHash('sha256').update('short').digest('hex') : HASH;
    expect(isValidEmployeeSyncKey(header, hash)).toBe(false);
  });
});

describe('EmployeeSyncController', () => {
  function setup(hash: string | undefined, result?: EmployeeSyncResult) {
    const run = jest.fn().mockResolvedValue(result);
    const sync = { keyHash: () => hash, run } as unknown as EmployeeSyncService;
    const status = jest.fn();
    const response = { status } as unknown as Response;
    return { controller: new EmployeeSyncController(sync), run, status, response };
  }

  it('answers 503 when no key hash is configured, without running', async () => {
    const { controller, run, status, response } = setup(undefined);

    const body = await controller.push(`Bearer ${KEY}`, {}, response);

    expect(status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ ok: false, reason: expect.stringMatching(/^NOT_CONFIGURED: /) });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 401 to a wrong key, without running', async () => {
    const { controller, run, status, response } = setup(HASH);

    const body = await controller.push('Bearer nope', {}, response);

    expect(status).toHaveBeenCalledWith(401);
    expect(body).toEqual({ ok: false, reason: expect.stringMatching(/^INVALID_KEY: /) });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([200, 400, 422] as const)('passes the run’s %s through', async (code) => {
    const result = {
      status: code,
      body: { ok: code === 200, mode: 'DRY', reason: null, runId: 'id', counts: {} },
    } as unknown as EmployeeSyncResult;
    const { controller, run, status, response } = setup(HASH, result);

    const body = await controller.push(`Bearer ${KEY}`, { employees: [] }, response);

    expect(run).toHaveBeenCalledWith({ employees: [] });
    expect(status).toHaveBeenCalledWith(code);
    expect(body).toBe(result.body);
  });
});
