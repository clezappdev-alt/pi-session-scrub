# Contributing

Thanks for looking. This is a small plugin with a narrow purpose: keep the Pi
`/resume` list clean and descriptive, with zero ceremony and zero tokens by
default. Contributions are welcome through issues and pull requests from forks.

**Response is best effort and there is no SLA.** This is a personal project kept
in the open; a question may sit for a while. A reproduction in the issue is what
moves it fastest.

## Requirements

- **Node.js `>=22.19.0`** — the same floor `package.json` declares in `engines`.
- **npm**, which ships with Node. Nothing else needs to be installed.

The plugin itself has **zero runtime dependencies**: it runs inside Pi, which
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
  `change`, `refactor`, and `slug` is kebab-case. Branches are short-lived and
  deleted after merge.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), English,
  imperative subject. One work unit per commit — code, tests and docs of the same
  behavior together; documentation-only work in its own commit.

## Fork flow

`upstream` is the canonical repository; `origin` is your fork.

```bash
gh repo fork clezappdev-alt/pi-session-scrub --clone
git remote add upstream https://github.com/clezappdev-alt/pi-session-scrub.git
git fetch upstream && git switch -c fix/<slug> upstream/master
# … work …
npm run check
git push -u origin fix/<slug>
gh pr create --repo clezappdev-alt/pi-session-scrub --fill
```

## What a pull request must contain

The template asks for it, and a PR without it is not reviewable:

- **Problem** — what is wrong or missing today.
- **Change** — what this does about it.
- **Verification** — the exact commands you ran and their result.
- **Risk** — `Risk: none`, or `Risk: item N (reason)` naming an item from the
  list in the template.
- **`Closes #N`** for the issue it resolves.

The PR title is the Conventional Commit subject. Pull requests that change
behavior without tests are sent back with a request for the missing test, not
silently closed.

## License

The project is MIT (see [`LICENSE`](LICENSE)). By contributing you agree your
contribution is licensed under the same terms. No CLA, no sign-off required.
