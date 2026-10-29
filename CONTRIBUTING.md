# Contributing

Thanks for looking. This is a small extension with a narrow purpose: keep the Pi
`/resume` list clean and descriptive, with zero ceremony and zero tokens by
default. Contributions are welcome through issues and pull requests from forks.

**Response is best effort and there is no SLA.** This is a personal project kept
in the open; a question may sit for a while. A reproduction in the issue is what
moves it fastest.

## Requirements

- **Node.js `>=22.19.0`** — the same floor `package.json` declares in `engines`.
- **npm**, which ships with Node. Nothing else needs to be installed.

The extension itself has **zero runtime dependencies**: it runs inside Pi, which
already provides its libraries. Everything in `devDependencies` exists to
typecheck and test this repository.

## Setup

```bash
npm ci --ignore-scripts
```

`npm ci` installs exactly what `package-lock.json` pins, and `--ignore-scripts`
is deliberate: no dependency's `install`/`postinstall` hook ever runs on your
machine or in CI. Keep it in every command you run against this repo.

## The check

One command verifies the code:

```bash
npm run check
```

It runs, in order:

| Step | Command | What it proves |
| --- | --- | --- |
| typecheck | `npm run typecheck` | `tsc -p tsconfig.json`, strict, over every file under `extensions/session-scrub/` |
| tests | `npm test` | `node --test "extensions/session-scrub/*.test.ts"` — the Node test runner, no framework |

CI runs `npm ci --ignore-scripts` and `npm run check`, verbatim, on Node
`22.19.0` and on the current LTS. A green local run and a green CI run should
mean the same thing; if they ever diverge, that is a bug in the setup, so please
report it.

## Development loop

Load the extension straight from the working tree and reload after each edit —
no install, no build step:

```bash
pi -e ./extensions/session-scrub/index.ts
# then, inside Pi:
/reload
```

Working looks like this: the `/scrub:*` commands and the `scrub_mark` /
`scrub_close` tools are listed by `/help`, and inside a project with sessions,
`/scrub:audit` prints a read-only table. Nothing is written until a command is
told to write.

There is no build step and no bundler. TypeScript runs through the Node runner
and through Pi's own loader.

## Branches and commits

- Branch: `<type>/<slug>`, where `type` is one of `feat`, `fix`, `docs`, `chore`,
  `ci`, `test`, `build`, `perf`, `style`, `refactor`, `revert`, and `slug` is
  kebab-case (`[a-z0-9._-]`). Branches are short-lived and deleted after merge.
  `change/` is legacy: the branches that carry it predate this list and stay, but
  nothing new should use it.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), English,
  imperative subject. One work unit per commit — code, tests and docs of the same
  behavior together; documentation-only work in its own commit.

## Issue first

Open an issue before the pull request, with the template that fits (`Bug report` or
`Feature request`). The issue carries the problem the PR claims to solve, and it is
the thing a stranger can read to decide whether the change is wanted before reading
the diff.

No approval step is required today: this is a one-maintainer project, and asking a
single human to approve their own issue is ceremony with no reader. The issue is
required, the approval is not. That will change the day a second maintainer
exists — not before.

## Fork flow

`upstream` is the canonical repository; `origin` is your fork.

```bash
gh repo fork clezappdev-alt/pi-session-scrub --clone
git remote add upstream https://github.com/clezappdev-alt/pi-session-scrub.git
git fetch upstream && git switch -c fix/<slug> upstream/master
# … work …
npm run check
git push -u origin fix/<slug>
gh pr create --repo clezappdev-alt/pi-session-scrub --web   # the template opens prefilled
```

Fill `Closes #N` and keep the sections; then apply the single `type:*` label. The gate
turns red until both are there, which is the point — it is cheaper to see it now than to
have a reviewer ask.

## What a pull request must contain

The template asks for it, and a PR without it is not reviewable:

- **Problem** — what is wrong or missing today.
- **Change** — what this does about it.
- **Verification** — the exact commands you ran and their result.
- **Risk** — `Risk: none`, or `Risk: item N (reason)` naming an item from the
  list in the template.
- **`Closes #N`** (closes on merge) or **`Refs #N`** (non-closing) — one of the two.
- **Exactly one `type:*` label.** The label is the record: it is what the release
  notes read. A checkbox in the body would be a second writer that can disagree
  with it.

Three of those are checked by CI (`.github/workflows/pr-check.yml`), so they cannot
be forgotten: the title, the issue reference, and the single `type:*` label. The
rest — the diff, the tests, the wording — stays human.

The `ceremony` job and both `check` jobs are **required** on `master`: a pull request
cannot merge while any of them is red. The repository admin can bypass a ruleset, so a
gate that turns out miscalibrated cannot lock the repository with no way out — and the
escape hatch is visible here instead of implied. Nobody else can bypass it, which is the
point: the rule the maintainer's own PR #42 skipped is now a rule for everyone.

"Required" also means the check reads the pull request as it is, not as the event that
triggered it remembered it: the pull request is read once from the API at check time —
title, body and labels in the same response — so a stale `opened` payload cannot fail a PR
whose label is right there, and two sources can never disagree inside one verdict.

That read is the gate's only network call, and it retries three times before it gives up.
When it does give up the job fails with the gate's message, never passes: a gate that goes
green on an input it could not read is a merge nobody checked.

Run the gate locally before opening the PR:

```bash
node --test .github/scripts/pr-ceremony.test.cjs
PR_TITLE="fix(scrub): x" PR_BODY="Closes #1" PR_LABELS='[{"name":"type:bug"}]' \
  node .github/scripts/pr-ceremony.cjs
```

Those three variables are the local path, with no token and no network. To replay CI
exactly, write the API's response to a file and point the gate at it — the file wins over
the variables, which is what makes one instant possible:

```bash
gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" > /tmp/pull-request.json
PR_JSON_PATH=/tmp/pull-request.json node .github/scripts/pr-ceremony.cjs
```

Size: the advisory budget is ~400 changed lines. Over it, say in the body why the
change is one PR (a dependency between the pieces, or tests and docs of the same
behavior), or split it — but never drop tests or docs to fit the number.

The PR title is the Conventional Commit subject. Pull requests that change
behavior without tests are sent back with a request for the missing test, not
silently closed.

## License

The project is MIT (see [`LICENSE`](LICENSE)). By contributing you agree your
contribution is licensed under the same terms. No CLA, no sign-off required.
