/**
 * Desk geometry and zone membership, read out of a bundled floor-plan SVG, and
 * the migration SQL that stores them.
 *
 * Runs at migration-generation time only (`src/scripts/generate-floor-plan-sql.ts`),
 * never in the browser and never at runtime: the web app shows the SVG as an
 * image and draws desks from the `Desk` rows this produces.
 *
 * The plan is a Figma export, so the parser is deliberately small: it walks the
 * tags in document order, keeps a stack of transforms, and understands the
 * transform functions SVG defines (`matrix`, `translate`, `scale`, `rotate`).
 * A desk is `g#Desk_N > rect#desk_body_N`; its zone is the nearest ancestor
 * `g#zone-<key>`. The stored box is the axis-aligned bounding box of the rect's
 * four corners after every transform on the rect and its ancestors.
 */

/** 2D affine matrix `[a, b, c, d, e, f]`, as in SVG's `matrix()`. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parses an SVG `transform` attribute into one matrix. */
export function parseTransform(value: string | undefined): Matrix {
  let result = IDENTITY;
  if (value === undefined) {
    return result;
  }
  for (const [, name, rawArgs] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const args = (rawArgs ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((arg) => arg !== '')
      .map(Number);
    const [p = 0, q, r, s, t, u] = args;
    let step: Matrix;
    switch (name) {
      case 'matrix':
        step = [p, q ?? 0, r ?? 0, s ?? 0, t ?? 0, u ?? 0];
        break;
      case 'translate':
        step = [1, 0, 0, 1, p, q ?? 0];
        break;
      case 'scale':
        step = [p, 0, 0, q ?? p, 0, 0];
        break;
      case 'rotate': {
        const radians = (p * Math.PI) / 180;
        // Exact for the right angles a plan uses, so -90 does not leave 6e-17s.
        const cos = Math.round(Math.cos(radians) * 1e12) / 1e12;
        const sin = Math.round(Math.sin(radians) * 1e12) / 1e12;
        const cx = q ?? 0;
        const cy = r ?? 0;
        step = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [
          1,
          0,
          0,
          1,
          -cx,
          -cy,
        ]);
        break;
      }
      default:
        throw new Error(`Unsupported SVG transform "${name}" in "${value}".`);
    }
    result = multiply(result, step);
  }
  return result;
}

export interface FloorPlanDesk {
  /** Number from the SVG id, 1-based. */
  readonly number: number;
  /** `D-` + the number padded to three digits. */
  readonly code: string;
  /** Key of the enclosing `g#zone-<key>`. */
  readonly zoneKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloorPlan {
  readonly width: number;
  readonly height: number;
  /** Zone keys in document order. */
  readonly zoneKeys: readonly string[];
  /** Desks ordered by number. */
  readonly desks: readonly FloorPlanDesk[];
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    if (name !== undefined && value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

function numberAttribute(attrs: Record<string, string>, name: string, fallback?: number): number {
  const raw = attrs[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Attribute "${name}" is missing or not a number.`);
  }
  return value;
}

interface OpenElement {
  readonly tag: string;
  readonly id: string | undefined;
  readonly ctm: Matrix;
}

/** Extracts the plan size, zones and desk boxes from the SVG source. */
export function parseFloorPlan(svg: string): FloorPlan {
  const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, '');
  const stack: OpenElement[] = [];
  const zoneKeys: string[] = [];
  const desks: FloorPlanDesk[] = [];
  let size: { width: number; height: number } | undefined;

  for (const [, closing, tag = '', rawAttrs = '', selfClosing] of withoutComments.matchAll(
    /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g
  )) {
    if (closing === '/') {
      const open = stack.pop();
      if (open?.tag !== tag) {
        throw new Error(`Unbalanced </${tag}>.`);
      }
      continue;
    }

    const attrs = attributes(rawAttrs);
    const parent = stack[stack.length - 1];
    const ctm = multiply(parent?.ctm ?? IDENTITY, parseTransform(attrs['transform']));

    if (tag === 'svg' && size === undefined) {
      const viewBox = (attrs['viewBox'] ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const [minX, minY, width, height] = viewBox;
      if (minX !== 0 || minY !== 0 || width === undefined || height === undefined) {
        throw new Error(`Expected a viewBox starting at 0 0, got "${attrs['viewBox']}".`);
      }
      size = { width, height };
    }

    const id = attrs['id'];
    const zone = /^zone-(.+)$/.exec(id ?? '')?.[1];
    if (tag === 'g' && zone !== undefined) {
      zoneKeys.push(zone);
    }

    const deskNumber = /^desk_body_(\d+)$/.exec(id ?? '')?.[1];
    if (tag === 'rect' && deskNumber !== undefined) {
      const number = Number(deskNumber);
      if (parent?.id !== `Desk_${number}`) {
        throw new Error(`rect#${id} is not inside g#Desk_${number}.`);
      }
      const zoneKey = [...stack]
        .reverse()
        .map((element) => /^zone-(.+)$/.exec(element.id ?? '')?.[1])
        .find((key) => key !== undefined);
      if (zoneKey === undefined) {
        throw new Error(`Desk ${number} is not inside any zone.`);
      }
      const x = numberAttribute(attrs, 'x', 0);
      const y = numberAttribute(attrs, 'y', 0);
      const width = numberAttribute(attrs, 'width');
      const height = numberAttribute(attrs, 'height');
      const corners = [
        apply(ctm, x, y),
        apply(ctm, x + width, y),
        apply(ctm, x, y + height),
        apply(ctm, x + width, y + height),
      ];
      const xs = corners.map(([cx]) => cx);
      const ys = corners.map(([, cy]) => cy);
      // Rounded corner by corner, so a box at x.5 keeps its exact width.
      const left = Math.round(Math.min(...xs));
      const top = Math.round(Math.min(...ys));
      desks.push({
        number,
        code: `D-${String(number).padStart(3, '0')}`,
        zoneKey,
        x: left,
        y: top,
        width: Math.round(Math.max(...xs)) - left,
        height: Math.round(Math.max(...ys)) - top,
      });
    }

    if (selfClosing !== '/') {
      stack.push({ tag, id, ctm });
    }
  }

  if (stack.length !== 0 || size === undefined) {
    throw new Error('The SVG is not a single, closed <svg> document.');
  }
  return { ...size, zoneKeys, desks: desks.sort((a, b) => a.number - b.number) };
}

/** Display names of the Praha zones (`desk-src-report.md` §2.16). Data, not i18n. */
export const PRAHA_ZONE_NAMES: Readonly<Record<string, string>> = {
  data: 'Data',
  finance_ops: 'Finance & Ops',
  marketing: 'Marketing',
  hr: 'HR',
  risk_ops: 'Risk & Ops',
  cs: 'Customer Success',
  cc: 'Contact Center',
  engineering1: 'Engineering 1',
  engineering2: 'Engineering 2',
  strategic: 'Strategic',
  sales1: 'Sales 1',
  sales2: 'Sales 2',
};

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The whole `migration.sql` of `20261112120200_praha_office`. Deterministic:
 * the same SVG yields the same bytes, which `floor-plan.spec.ts` asserts
 * against the committed file.
 */
export function prahaOfficeMigrationSql(plan: FloorPlan): string {
  const zoneRows = plan.zoneKeys.map((key) => {
    const name = PRAHA_ZONE_NAMES[key];
    if (name === undefined) {
      throw new Error(`Zone "${key}" has no display name.`);
    }
    return `  (${quote(key)}, ${quote(name)})`;
  });
  const deskRows = plan.desks.map(
    (desk) =>
      `  (${quote(desk.code)}, ${quote(desk.zoneKey)}, ${desk.x}, ${desk.y}, ${desk.width}, ${desk.height})`
  );

  return `-- GENERATED by \`libs/sit-and-park/database/src/scripts/generate-floor-plan-sql.ts\`
-- from \`apps/sit-and-park/web/public/floorplans/praha.svg\`. Do not edit by hand:
-- regenerate, and \`floor-plan.spec.ts\` fails until this file matches.
--
-- The Praha office, its ${plan.zoneKeys.length} zones and ${plan.desks.length} desks. Zone membership comes from the
-- SVG's nesting (\`g#zone-<key> > g#Desk_N\`), not from the source app's seed,
-- which is stale (\`doc/decision/0324-*\`). Geometry is the axis-aligned box of
-- each \`rect#desk_body_N\` after every transform on it and its ancestors, in
-- viewBox units (\`doc/decision/0325-*\`).
--
-- Ids are \`gen_random_uuid()\` (v4): Prisma's \`uuid(7)\` default is generated
-- client-side and does not exist in SQL. Nothing depends on the version.

INSERT INTO "Office" ("id", "name", "active", "floorPlan", "floorPlanWidth", "floorPlanHeight", "updatedAt")
VALUES (gen_random_uuid(), 'Praha', true, 'praha', ${plan.width}, ${plan.height}, NOW());

INSERT INTO "Zone" ("id", "officeId", "key", "name")
SELECT gen_random_uuid(), o."id", v."key", v."name"
FROM (VALUES
${zoneRows.join(',\n')}
) AS v("key", "name")
JOIN "Office" o ON o."name" = 'Praha';

INSERT INTO "Desk" ("id", "officeId", "zoneId", "code", "x", "y", "width", "height", "updatedAt")
SELECT gen_random_uuid(), o."id", z."id", v."code", v."x", v."y", v."width", v."height", NOW()
FROM (VALUES
${deskRows.join(',\n')}
) AS v("code", "zoneKey", "x", "y", "width", "height")
JOIN "Office" o ON o."name" = 'Praha'
JOIN "Zone" z ON z."officeId" = o."id" AND z."key" = v."zoneKey";

-- Every existing user and spot is in Praha, the only office there has been.
UPDATE "User" SET "officeId" = (SELECT "id" FROM "Office" WHERE "name" = 'Praha')
WHERE "officeId" IS NULL;

UPDATE "ParkingSpot" SET "officeId" = (SELECT "id" FROM "Office" WHERE "name" = 'Praha')
WHERE "officeId" IS NULL;

-- A spot always belongs to an office; a user may not yet (JIT provisioning).
ALTER TABLE "ParkingSpot" ALTER COLUMN "officeId" SET NOT NULL;
`;
}
