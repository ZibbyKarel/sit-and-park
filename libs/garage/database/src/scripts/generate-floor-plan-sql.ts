/**
 * Regenerates `prisma/migrations/20261112120200_praha_office/migration.sql`
 * from the bundled Praha floor plan. Run from the repo root:
 *
 *   node --require @swc-node/register libs/garage/database/src/scripts/generate-floor-plan-sql.ts
 *
 * Only for an unapplied migration or a fresh history: an applied migration's
 * checksum is recorded, so changing the file afterwards makes `prisma migrate
 * status` report it as modified. A changed plan needs a new migration.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFloorPlan, prahaOfficeMigrationSql } from '../lib/floor-plan';

const root = join(__dirname, '..', '..', '..', '..', '..');
const svgPath = join(root, 'apps', 'garage', 'web', 'public', 'floorplans', 'praha.svg');
const migrationPath = join(
  root,
  'libs',
  'garage',
  'database',
  'prisma',
  'migrations',
  '20261112120200_praha_office',
  'migration.sql'
);

const plan = parseFloorPlan(readFileSync(svgPath, 'utf8'));
writeFileSync(migrationPath, prahaOfficeMigrationSql(plan));
console.log(
  `Wrote ${plan.desks.length} desks in ${plan.zoneKeys.length} zones to ${migrationPath}.`
);
