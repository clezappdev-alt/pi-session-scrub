# Tasks — session-scrub-write-guards

The requirement delta is `spec.md` in this directory (WG-01…WG-04). This file is the
one task ledger.

- [x] **T1 — the tests, first.** `sessionfs.test.ts` gains the refusals before the
  guards exist: symlinked backup source, symlinked `AGENTS.md`, the regular/missing
  `AGENTS.md` append that must keep working, the restore-overwrite refusal, and the
  trash→restore round trip. Observed RED: the suite could not load the module.
- [x] **T2 — one guard, two call sites.** `refuseNonRegularFile` in `sessionfs.ts`;
  `backupSessionFile` and the new `appendPolicyBlock` both call it before writing.
- [x] **T3 — the moves become testable.** `moveToTrash` / `moveFromTrash` moved from
  `index.ts` to `sessionfs.ts`, unchanged; `index.ts` imports them.
- [x] **T4 — the init write goes through the guard.** `handleScrubInit` calls
  `appendPolicyBlock` instead of `writeFileSync`, and a `doccheck` source gate fails
  if it ever calls `writeFileSync` again (the handler needs a host, so behavior there
  cannot be unit-tested).
- [x] **T5 — GREEN.** `npm run check`: 271 tests, 0 fail, typecheck clean.
- [x] **T6 — docs.** `behavior.md` Layer B for the guard on both writes and the
  restore refusal; `SECURITY.md`'s `## Known gap` becomes the guards that exist.
