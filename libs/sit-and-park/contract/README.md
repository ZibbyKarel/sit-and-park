# @sit-and-park/contract

The single source of truth for every shape that crosses the FE ↔ BE boundary.
No endpoint, DTO or realtime event may exist in code before it exists here.

- `src/schemas/` — shared Zod entity schemas, primitives and the error contract
  .
- `src/api/` — oRPC procedures, entry point `@sit-and-park/contract`.
- `src/realtime/` — Socket.io event payload schemas, entry point
  `@sit-and-park/contract/realtime`.

Types are always derived with `z.infer`, never hand-written alongside a schema.
Allowed npm dependencies are limited by ESLint to `zod`, `@orpc/contract` and
`tslib` — the contract must never reach for a transport.

Documentation: `doc/contract.md`.

## Tests

```bash
pnpm nx run contract:test
```
