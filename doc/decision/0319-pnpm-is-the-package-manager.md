# 0319 – pnpm is the package manager, and npm is not used anywhere

**Date:** 2026-10-29 · **Status:** accepted · **Task:** repository owner's request

## Context

The repository carried two lockfiles: `package-lock.json`, which CI (`npm ci`)
and both Dockerfiles used, and a committed `pnpm-lock.yaml` with
`pnpm-workspace.yaml` (an `allowBuilds` list), which nothing used. Nx detects
the pnpm lockfile and refuses to run against an npm-installed `node_modules`
("pnpm lockfile detected, but node_modules/.modules.yaml is missing"). Two
lockfiles can also disagree about a resolution, and only one of them was ever
tested.

## What

- `package-lock.json` is deleted. `pnpm-lock.yaml` is the only lockfile and `package.json` pins `"packageManager": "pnpm@11.18.0"`.
- Install scripts are allow-listed by `allowBuilds` in `pnpm-workspace.yaml`.
- CI sets up pnpm with `pnpm/action-setup@v4` before `actions/setup-node` (`cache: pnpm`) and installs with `pnpm install --frozen-lockfile`. Commands are `pnpm nx …` and `pnpm exec …`, never `npx`.
- Both Dockerfiles run `corepack enable`, copy `pnpm-lock.yaml` and `pnpm-workspace.yaml` next to `package.json`, and install with `pnpm install --frozen-lockfile`.
- Docs, code comments and the Playwright and global-setup commands say `pnpm`.

## Consequences

- `npm ci` and `npx` no longer apply anywhere. The commands in `CLAUDE.md` and `README.md` are `pnpm install`, `pnpm <script>`, `pnpm nx …` and `pnpm exec …`.
- pnpm's strict `node_modules` layout means a package that is imported but not declared no longer resolves by accident. Declare it in `package.json`.
- `express`, `@types/express`, `ts-node` and `tsconfig-paths` are now declared. They had been imported or required without being listed, and resolved only because npm hoists everything. Inside a pnpm Docker build `api:build` failed with "Can't resolve 'express'".
- The API image's `runtime-deps` stage installs the pruned `pnpm-lock.yaml` Nx now emits with `--frozen-lockfile`, which the old pruned `package-lock.json` could not do. The `migrator` stage runs `node_modules/.bin/prisma` directly so corepack never downloads pnpm at container start.
- Historical decision records still say `npm`; they describe what was true when written and are not edited.
