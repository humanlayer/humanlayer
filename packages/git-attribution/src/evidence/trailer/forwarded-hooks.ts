import { readdir } from 'node:fs/promises'

/**
 * The trampoline NAME FLOOR (hooks-path mode) and the arm-time repo listing that self-heals it.
 * `core.hooksPath` is exclusive, so the hooks dir must speak for every hook a repo might have —
 * completeness of these names is a correctness contract: a missing one is a repo hook that
 * silently stops firing for agent commits.
 */

/**
 * Every hook git v2.55.0 documents in githooks(5), EXCEPT prepare-commit-msg (the stamper).
 * A plain audited list, defended by:
 *   1. a CANARY test parsing the INSTALLED git's githooks(5) man page, failing the suite when
 *      any dev/CI machine's git documents a hook the list lacks (see session-hooks.test.ts) —
 *      the failure message names the missing hook, and the fix is one line here;
 *   2. arm-time listing of the repo's actual hooks dir ({@link listRepoHookNames}), which
 *      covers hooks in real use regardless of this list.
 * Server-side names are included — harmless locally, and the hooks dir may be resolved by any
 * git command a session runs.
 */
export const FORWARDED_HOOKS: readonly string[] = [
	'applypatch-msg',
	'commit-msg',
	'fsmonitor-watchman',
	'p4-changelist',
	'p4-post-changelist',
	'p4-pre-submit',
	'p4-prepare-changelist',
	'post-applypatch',
	'post-checkout',
	'post-commit',
	'post-index-change',
	'post-merge',
	'post-receive',
	'post-rewrite',
	'post-update',
	'pre-applypatch',
	'pre-auto-gc',
	'pre-commit',
	'pre-merge-commit',
	'pre-push',
	'pre-rebase',
	'pre-receive',
	'proc-receive',
	'push-to-checkout',
	'reference-transaction',
	'sendemail-validate',
	'update',
]

/**
 * ## Prior art (GitHub survey, 2026-08) — how other vendors cope with hook multiplexing
 *
 * Everyone who interposes on git hooks maintains a hardcoded name list; nobody forwards as
 * completely as our trampolines, and nobody has a freshness mechanism for the list.
 * One line per vendor — let the editor scroll. [n] = link below.
 *
 *   vendor            mechanism                                  names     chains repo hooks?               stdin+veto intact?        repo residue              blast radius                 freshness                          floor
 *   ----------------  -----------------------------------------  --------  -------------------------------  ------------------------  ------------------------  ---------------------------  ---------------------------------  -----
 *   husky [1]         core.hooksPath -> .husky/_ stubs           14        NO (shadows .git/hooks)          -                         repo files + config       all commits                  none                               2.9
 *   lefthook [2]      shims in resolved hooks dir                28        backup-rename .old only          -                         repo files                all commits                  "keep in sync" comment             any
 *   pre-commit [3]    shims in hooks dir                         10        YES: .legacy re-exec, rc OR      YES (stdin replayed)      repo files                all commits                  none                               any
 *   overcommit [4]    master script per derived name             (dir)     backup to old-hooks/ only        -                         repo files                all commits                  n/a (own-dir derived)              any
 *   captainhook [5]   templates in repo hooks dir                8+1       install-time move only           -                         repo files                all commits                  none                               any
 *   rusty-hook [6]    shims in hooks dir                         19        NO                               -                         repo files                all commits                  none (stale in the wild)           any
 *   pivotal ghc [7]   hooksPath symlinks -> .base-hook           ~10       buggy (-f not -x; baked path)    partial (calls, no exec)  global config             all commits                  none                               2.9
 *   jdx/hk [8]        git hook.* config entries (2.54+)          n/a       native (additive by design)      native                    config entries            config scope                 n/a (git validates)                2.54
 *   git itself [9]    doc scrape -> hook-list.h at build         (gen)     -                                -                         -                         -                            generate-hooklist.sh               -
 *   OURS              env hooksPath trampolines / env hook.*     28        YES: exec passthru / native      YES (exec: all intact)    ZERO (env-only)           armed session trees only     man-page canary + arm listing      2.31+
 *
 * The load-bearing contrasts: every vendor's name list is a plain audited constant, ours
 * included — but ours is the only one with FRESHNESS enforcement (the githooks(5) canary fails
 * the suite naming the missing hook; arm-time repo listing covers hooks in use regardless).
 * Pivotal bakes the forwarding target and misses repo hooksPath — ours re-resolves per
 * invocation. And on git >= 2.54 we take the hk route: git-native additive registration, zero
 * trampolines involved at all.
 *
 * [1] https://github.com/typicode/husky/blob/main/index.js
 * [2] https://github.com/evilmartians/lefthook/blob/master/internal/config/available_hooks.go
 * [3] https://github.com/pre-commit/pre-commit/blob/main/pre_commit/commands/hook_impl.py
 * [4] https://github.com/sds/overcommit/blob/main/lib/overcommit/utils.rb
 * [5] https://github.com/captainhook-git/captainhook/blob/main/src/Hooks.php
 * [6] https://github.com/swellaby/rusty-hook/blob/master/src/hooks.rs
 * [7] https://github.com/pivotal-cf/git-hooks-core
 * [8] https://github.com/jdx/hk/blob/main/src/cli/install.rs
 * [9] https://github.com/git/git/blob/master/tools/generate-hooklist.sh
 * (pre-commit hook types: https://github.com/pre-commit/pre-commit/blob/main/pre_commit/clientlib.py)
 */

/**
 * Hook filenames are an EXECUTION surface (they become files in our dir that git runs), so only
 * names shaped exactly like git's own hook vocabulary are ever accepted from a repo listing.
 */
export const HOOK_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/

/**
 * The hook names the ARM repo actually has — the self-healing half of trampoline completeness.
 * The static FORWARDED_HOOKS floor can lag a brand-new git hook, but a repo USING that hook has
 * a file named after it in its effective hooks dir, and arming is looking right at it: any name
 * we don't already know gets a trampoline too. `.sample` files fail HOOK_NAME_RE's charset, and
 * unknown names cost one inert forwarder file in OUR state dir at worst.
 */
export async function listRepoHookNames(repoHooksDir: string): Promise<string[]> {
	const entries = await readdir(repoHooksDir).catch(() => [])
	return entries.filter((name) => HOOK_NAME_RE.test(name) && name !== 'prepare-commit-msg')
}
