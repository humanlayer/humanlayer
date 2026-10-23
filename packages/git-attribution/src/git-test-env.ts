import { afterAll, beforeAll } from 'vitest'

/**
 * Makes temp-repo git tests (this package's hook/lease/stamper suites, the daemon's
 * commit-tracker / commit-watcher, and lib/github/git-cli.service) hermetic: for the duration of
 * the calling file, git subprocesses ignore the developer's global and system gitconfig. A
 * `git init` repo otherwise inherits ~/.gitconfig, and two common settings break these suites:
 *   - `commit.gpgsign = true` makes every `git commit` block on a GPG/pinentry passphrase prompt —
 *     a hang, and invisible under scripts/run-silent.ts (which buffers all output).
 *   - a global `core.hooksPath` (husky) relocates the hooks dir, so the trailer-hook installer
 *     declines and every suite silently tests the skip path — and the dev's own hooks run on each
 *     commit, making them slow or failing outright.
 * Pointing global + system config at /dev/null is the same isolation git's own test harness uses.
 *
 * Implemented by setting process.env (restored afterAll) rather than threading an env through every
 * call site: these files spawn git in ~30 places — including the code under test via its own
 * execFile — and any call that inherits process.env would otherwise still see ~/.gitconfig. The
 * consuming suites run with fileParallelism off, so files run sequentially in one worker and this
 * set/restore can't race another file. This is the single source of truth so the guard can't
 * drift across suites again (it did once: only two of them pinned commit.gpgsign, and none pinned
 * core.hooksPath).
 */
const HERMETIC_GIT_ENV = {
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
}

export function useHermeticGitConfig(): void {
	const prior: Record<string, string | undefined> = {}
	beforeAll(() => {
		for (const key of Object.keys(process.env)) {
			if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) {
				prior[key] = process.env[key]
				delete process.env[key]
			}
		}
		for (const [key, value] of Object.entries(HERMETIC_GIT_ENV)) {
			prior[key] = process.env[key]
			process.env[key] = value
		}
	})
	afterAll(() => {
		for (const key of Object.keys(HERMETIC_GIT_ENV)) {
			if (prior[key] === undefined) delete process.env[key]
			else process.env[key] = prior[key]
		}
	})
}
