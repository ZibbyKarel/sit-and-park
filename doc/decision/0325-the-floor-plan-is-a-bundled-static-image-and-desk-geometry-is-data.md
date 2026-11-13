# 0325 – The floor plan is a bundled static image and desk geometry is data

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source stores an admin-set URL, fetches the SVG and injects it with `innerHTML` (stored XSS), then finds desks with a parser, `desk-geometry.ts`, that mis-identifies desk 1 and ignores rotation. The shipped SVG is verified free of scripts, handlers, `foreignObject` and external references.

## Decision

The SVG ships as a static asset of the web app and is drawn as an `<image>`; it is never parsed or injected in the browser. `Office.floorPlan` names a bundled plan (only `praha` exists) with its width and height. Desk geometry (`x`, `y`, `width`, `height`, the axis-aligned box after rotation) is stored on `Desk` and drawn by React as `<rect>` elements on top.

## Consequences

- No sanitising step to get wrong: the XSS hole is removed, not patched.
- Geometry is extracted once, when the migration is generated; no runtime parser exists.
- A second office needs a new bundled asset and a migration; an admin upload is out of scope.

## If wrong

If admins must upload plans, that needs a sanitiser and storage and is a new decision. Geometry in data keeps the rendering side unchanged.
