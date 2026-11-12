# 0324 – Zones are a table per office

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source keeps `zone` as a bare string key on each desk, with labels in a client constant, and its seed numbering disagrees with its SVG.

## Decision

`Zone` is a table (`officeId`, `key`, `name`, unique per office) and `Desk.zoneId` references it. The Praha zones and desk membership come from the SVG's nesting at migration-generation time.

## Consequences

- A zone can be renamed without touching desks; an office owns its zones.
- Zone names are data and so not translated; only UI chrome goes through i18n.
- Admin gets an offices-and-zones screen.

## If wrong

Collapsing zones back to a string on `Desk` is a small migration; the reverse is why the table was chosen.
