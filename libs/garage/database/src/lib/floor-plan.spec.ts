/**
 * The Praha desk rows are generated once from the SVG and committed as a
 * migration, so two things must hold: the committed migration is exactly what
 * the generator produces today, and what it produces is the geometry the plan
 * actually draws. The second is checked against facts in the SVG the parser
 * does not use — each desk's label sits at the centre of its desk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFloorPlan, parseTransform, prahaOfficeMigrationSql } from './floor-plan';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SVG = readFileSync(
  join(ROOT, 'apps', 'garage', 'web', 'public', 'floorplans', 'praha.svg'),
  'utf8'
);
const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20261112120200_praha_office',
    'migration.sql'
  ),
  'utf8'
);

const plan = parseFloorPlan(SVG);

describe('the Praha floor plan', () => {
  it('the committed migration is exactly what the generator produces', () => {
    expect(MIGRATION).toBe(prahaOfficeMigrationSql(plan));
  });

  it('has the viewBox size the office row stores', () => {
    expect([plan.width, plan.height]).toEqual([22473, 5835]);
  });

  it('has desks 1–221, no gaps, coded D-001 … D-221', () => {
    expect(plan.desks.map((desk) => desk.number)).toEqual(
      Array.from({ length: 221 }, (_, index) => index + 1)
    );
    expect(plan.desks[0]?.code).toBe('D-001');
    expect(plan.desks[220]?.code).toBe('D-221');
  });

  it('puts each desk in the zone the SVG nests it in', () => {
    const counts: Record<string, number> = {};
    for (const desk of plan.desks) {
      counts[desk.zoneKey] = (counts[desk.zoneKey] ?? 0) + 1;
    }
    expect(counts).toEqual({
      sales2: 12,
      sales1: 24,
      engineering1: 45,
      hr: 10,
      marketing: 22,
      strategic: 12,
      engineering2: 36,
      cc: 24,
      cs: 6,
      risk_ops: 12,
      finance_ops: 12,
      data: 6,
    });
    expect(plan.desks.filter((desk) => desk.zoneKey === 'marketing').map((d) => d.number)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => 92 + i),
      212,
      213,
      214,
      215,
      216,
      217,
      218,
      219,
    ]);
  });

  it('applies the rotation: 191 vertical desks, 30 horizontal', () => {
    const sizes = plan.desks.map((desk) => `${desk.width}x${desk.height}`);
    expect(sizes.filter((size) => size === '139x249')).toHaveLength(191);
    expect(sizes.filter((size) => size === '249x139')).toHaveLength(30);
  });

  it('every desk lies inside the viewBox', () => {
    for (const desk of plan.desks) {
      expect(desk.x).toBeGreaterThanOrEqual(0);
      expect(desk.y).toBeGreaterThanOrEqual(0);
      expect(desk.x + desk.width).toBeLessThanOrEqual(plan.width);
      expect(desk.y + desk.height).toBeLessThanOrEqual(plan.height);
    }
  });

  it('no two desks overlap by more than a hair', () => {
    for (const [index, a] of plan.desks.entries()) {
      for (const b of plan.desks.slice(index + 1)) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(overlapX <= 1 || overlapY <= 1).toBe(true);
      }
    }
  });

  it("each desk's label sits at the centre of its box", () => {
    // `text#D-N` is a sibling of the rect with no transform of its own; its
    // x/y is the centre the export placed it at, independent of the rect's
    // rotation — an independent witness that the transform was applied.
    const labels = new Map(
      [...SVG.matchAll(/<text id="D-(\d+)" x="([\d.]+)" y="([\d.]+)"/g)].map((match) => [
        Number(match[1]),
        [Number(match[2]), Number(match[3])] as const,
      ])
    );
    expect(labels.size).toBe(221);
    for (const desk of plan.desks) {
      const [labelX, labelY] = labels.get(desk.number) ?? [NaN, NaN];
      expect(Math.abs(desk.x + desk.width / 2 - labelX)).toBeLessThanOrEqual(1);
      expect(Math.abs(desk.y + desk.height / 2 - labelY)).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseTransform', () => {
  it('rotate(-90 cx cy) turns about the given point', () => {
    const [a, b, c, d, e, f] = parseTransform('rotate(-90 10 20)');
    // (10, 20) stays put; (11, 20) moves to (10, 19).
    expect([a * 10 + c * 20 + e, b * 10 + d * 20 + f]).toEqual([10, 20]);
    expect([a * 11 + c * 20 + e, b * 11 + d * 20 + f]).toEqual([10, 19]);
  });

  it('composes left to right, like SVG', () => {
    expect(parseTransform('translate(5 0) scale(2)')).toEqual([2, 0, 0, 2, 5, 0]);
  });

  it('refuses a transform it does not understand', () => {
    expect(() => parseTransform('skewX(10)')).toThrow('Unsupported');
  });
});
