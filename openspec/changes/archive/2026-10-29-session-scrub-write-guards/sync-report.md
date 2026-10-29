# Sync report — `session-scrub-write-guards`

**Delta:** `spec.md`, written 2026-10-27 in `2e17b1c` — clauses WG-01…WG-04.
**First released in:** `v0.6.0`.
**Reconciled into the canonical spec:** Slice 6 `WG-01…WG-04` and REQ-07 in place, `aead001`.
**Left out, by design:** the guards that already held (path components through `basename`, the parse → back up → write → verify order, the trash and backup roots outside Pi's `sessions/`); moving a symlink is not writing through one, because `rename` moves the link itself.
**Archived:** 2026-10-29, in the sweep that closed the nine finished changes.
