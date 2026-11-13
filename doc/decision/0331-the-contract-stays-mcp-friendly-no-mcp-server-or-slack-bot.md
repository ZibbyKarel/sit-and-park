# 0331 – The contract stays MCP-friendly; no MCP server or Slack bot is built

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source once had an MCP server, since removed, and its tables remain as dead weight. A Slack bot was discussed. Neither is requested now.

## Decision

No MCP server and no Slack bot are built. The desk contract is written so one could be added: every procedure has a description, flat inputs, and no state beyond the caller's identity. Slack stays outbound notifications only, as before.

## Consequences

- A later MCP adapter wraps procedures without reshaping them.
- The dead MCP tables of the source are not ported.

## If wrong

Little is lost: the constraint costs a description per procedure and a habit of flat inputs.
