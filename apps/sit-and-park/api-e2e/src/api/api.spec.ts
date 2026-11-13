/**
 * That the API process is up, and that the two routes outside the ordinary
 * pattern behave.
 *
 * ## `GET /api` answers 404
 *
 * No scaffold controller is mounted at `/api`: `orpc-route-parity.spec.ts`
 * enumerates routes from the compiled Nest container and fails on any route
 * the contract does not declare, so a leftover stub cannot hide.
 *
 * The assertion still holds whatever is or is not mounted there: a stranger sees
 * no scaffold body and no stack trace.
 *
 * `/health/live` is deliberately *not* behind the global `/api` prefix:
 * `configure-app.ts` excludes the health controller from `setGlobalPrefix`, so a
 * probe reaches it without knowing the API's mount point.
 */
import axios from 'axios';

const anyStatus = { validateStatus: () => true } as const;

describe('the API is reachable', () => {
  it('answers the liveness probe without the /api prefix', async () => {
    const res = await axios.get(`/health/live`);

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok' });
  });

  it('answers the readiness probe, which also proves the database is reachable', async () => {
    const res = await axios.get(`/health/ready`);

    expect(res.status).toBe(200);
  });

  it('serves nothing at the bare /api prefix to a caller with no token', async () => {
    const res = await axios.get(`/api`, anyStatus);

    // 404, not 401: the scaffold controller that used to answer here is deleted.
    // See this file's header for why it took two corrections to get here.
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.data);
    // Whatever is or is not mounted there, an anonymous caller does not see it.
    expect(body).not.toContain('Hello API');
    // And the body carries no stack trace, whatever the log does with one.
    expect(body).not.toContain('at ');
  });
});
