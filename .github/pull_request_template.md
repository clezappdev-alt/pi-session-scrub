<!--
  Title: a Conventional Commit subject, e.g. `fix(scrub): a restore never overwrites`.

  A pull request that changes behavior without the Verification section is not
  reviewable and gets sent back — not out of ceremony, but because nobody else
  can reproduce the claim.

  CI checks three things about this body and the PR's metadata (ci.yml is what
  proves the code): the title is a Conventional Commit, the body links an issue,
  and exactly one `type:*` label is applied. The label is the record — see
  CONTRIBUTING.md § What a pull request must contain.
-->

## Linked issue

<!-- `Closes #N` closes it on merge; `Refs #N` links without closing. One of the two. -->

Closes #

## Problem

<!-- What is wrong or missing today. Link the issue if there is one. -->

## Change

<!-- What this does about it, and anything you deliberately did not touch. -->

## Verification

<!--
  The exact commands you ran and their result. CI runs the same ones, so a
  green local run and a green CI run should mean the same thing.

  $ npm ci --ignore-scripts
  $ npm run check
  ...
-->

## Risk

<!--
  One of:
    Risk: none
    Risk: item N (reason)   — N from 1..6: data/irreversible, security,
                              contract, concurrency, delivery, no test would catch it
-->

## Checklist

- [ ] Linked to an issue (`Closes #N` or `Refs #N` above)
- [ ] Exactly one `type:*` label applied (it is the record; this is not a checkbox)
- [ ] Tests cover the behavior this changes (or the change is documentation only)
- [ ] `npm run check` passes locally
- [ ] Docs updated where the change is visible to a user
- [ ] If this is over ~400 changed lines: the body says why it is one PR
