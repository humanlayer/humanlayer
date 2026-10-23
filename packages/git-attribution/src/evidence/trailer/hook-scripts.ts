import { SESSION_EXPIRES_ENV_VAR, SESSION_ID_ENV_VAR, SESSION_URL_ENV_VAR } from '../../git-env'
import { SESSION_TRAILER_TOKEN } from './session-trailer'

/**
 * The sh sources ensureSessionHooksDir writes — multi-line template segments with the WHY as TS
 * comments between them, so the scripts on disk carry no prose: what ships is only what runs
 * (plus the shebang and the marker line, which identifies the files as ours). `\$` is sh's `$`
 * wherever TS would interpolate; everything else reads as plain sh. Everything here is POSIX sh,
 * not bash: minimal containers routinely have git without bash, and a hook whose interpreter is
 * missing aborts every commit.
 *
 * The stamper is ENV-ONLY (v8): the session's id, deep-link URL and expiry horizon all arrive as
 * env vars frozen into the process tree at spawn, and the stamper reads NO state at commit time.
 * The expiry is what bounds a leaked env (a tmux server born inside a session outlives it);
 * every relaunch re-mints it. The per-repo opt-out is plain git config the user owns:
 * `git config humanlayer.attribution false`.
 */

/** Marker carried by both stamper entries (v8 = env-only stamping, no commit-time state). */
export const ENV_HOOK_MARKER = 'humanlayer-session-trailer-hook:v8'

// ONE trampoline body serves every forwarded hook name (hooks-path mode only): git invokes
// hooks by path, so the script derives WHICH hook it is from its own basename. Byte-identical
// files mean writeIfChanged degenerates to a no-op compare per name.
export const TRAMPOLINE =
	`#!/bin/sh
NAME=$(basename -- "$0")
` +
	// Resolve the repo's OWN hooks dir at runtime — never a baked path, so one shared dir stays
	// correct when a session wanders across repos (clones, nested repos, submodules) and a
	// husky-style core.hooksPath is honored. Scope filtering is what keeps this from circling
	// back to OUR dir: `--show-scope` labels env-provided entries `command`, so dropping those
	// leaves the repo's own file config (local/global/system). Deliberately NOT `env -u
	// GIT_CONFIG_COUNT`: stripping the whole env config also strips the USER'S entries, and a
	// container that ships `safe.directory` that way then fails resolution outright — which
	// would silently skip every repo hook, vetoes included, for agent commits only.
	// `--show-scope` predates our git floor (2.26 < 2.31). A relative value (husky's `.husky`)
	// needs no absolutizing: git runs hooks with cwd at the worktree top level.
	`REAL_HOOKS=$(git config --show-scope --get-all core.hooksPath 2>/dev/null | grep -v '^command' | tail -1 | cut -f2-)
if [ -z "$REAL_HOOKS" ]; then
	GIT_DIR_PATH=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0
	REAL_HOOKS="$GIT_DIR_PATH/hooks"
fi
` +
	// exec passthrough: argv, stdin, veto and exit code reach the repo's hook untouched.
	// (Considered and rejected: `git hook run --ignore-missing` — run_hooks sets no_stdin, which
	// would sever the stdin pre-push/pre-receive hooks consume.)
	`[ -x "$REAL_HOOKS/$NAME" ] && exec "$REAL_HOOKS/$NAME" "$@"
exit 0
`

// The stamping contract: a commit without the session env does no work, and past the env guard
// NOTHING may fail (or outlive) the commit — every failure path is `exit 0`, stderr is
// discarded, and the message file is only ever replaced wholesale by a rename of fully-written
// output.
const STAMPER_HEADER =
	`#!/bin/sh
` +
	// The one comment that stays in the bytes: it identifies the file as ours (tests and humans
	// grep for it) and its version.
	`# ${ENV_HOOK_MARKER}
set -u
`

// hooks-path mode shadows the repo's own prepare-commit-msg, so that entry must run it manually
// first — argv and veto intact, resolved at runtime like the trampolines.
const CHAIN_REPO_HOOK = `REAL_HOOKS=$(git config --show-scope --get-all core.hooksPath 2>/dev/null | grep -v '^command' | tail -1 | cut -f2-)
if [ -z "$REAL_HOOKS" ]; then
	CHAIN_GIT_DIR=$(git rev-parse --absolute-git-dir 2>/dev/null) && REAL_HOOKS="$CHAIN_GIT_DIR/hooks"
fi
if [ -n "$REAL_HOOKS" ] && [ -x "$REAL_HOOKS/prepare-commit-msg" ]; then
	"$REAL_HOOKS/prepare-commit-msg" "$@" || exit $?
fi
`

const STAMP_BODY =
	// A human's commit exits on the env guards without doing ANY work: no session identity in
	// the env means our stamper is a no-op even where the env config hosted it.
	`[ -n "\${${SESSION_ID_ENV_VAR}:-}" ] || exit 0
[ -n "\${${SESSION_URL_ENV_VAR}:-}" ] || exit 0
MSG_FILE=\${1:-}
[ -n "$MSG_FILE" ] || exit 0
` +
	// $2 is the message SOURCE. Stamping happens BEFORE the editor, so touching the buffer of an
	// interactive commit (source empty) would defeat git's abort-on-empty-message safety — quit
	// editor, and a trailer-only commit gets created; same for an unedited -t template. Only
	// pre-composed sources are stamped: -m/-F ("message"), -c/-C/--amend ("commit"), merges and
	// squashes. Agents commit via exactly these; interactive typing is a human's flow anyway.
	`case "\${2:-}" in message | commit | merge | squash) ;; *) exit 0 ;; esac
exec 2>/dev/null
` +
	// The liveness gate: env cannot be revoked once spawned, so stamping is bounded by the
	// horizon the launcher minted (epoch seconds). Malformed or missing values fail CLOSED — a
	// mangled env must not stamp forever.
	`case "\${${SESSION_EXPIRES_ENV_VAR}:-}" in '' | *[!0-9]*) exit 0 ;; esac
NOW=$(date +%s) || exit 0
[ "\${${SESSION_EXPIRES_ENV_VAR}}" -gt "$NOW" ] || exit 0
GIT_DIR_PATH=$(git rev-parse --absolute-git-dir) || exit 0
` +
	// A REPLAY (rebase, cherry-pick) recreates existing commits — their authorship is not this
	// session's. REVERT_HEAD is deliberately not checked: a revert is new session-authored work
	// (and a clean revert leaves no marker at hook time anyway). MERGE_HEAD is none of these.
	`for REPLAY_MARKER in rebase-merge rebase-apply CHERRY_PICK_HEAD; do
	[ -e "$GIT_DIR_PATH/$REPLAY_MARKER" ] && exit 0
done
` +
	// The sequencer dir alone is ambiguous: a MULTI-COMMIT revert runs under it too (with no
	// REVERT_HEAD at hook time — verified), and reverts must stamp. Its todo names the operation,
	// so allow only a leading `revert` line through; anything else (pick, unreadable, between-step
	// residue) suppresses, same as before.
	`if [ -e "$GIT_DIR_PATH/sequencer" ]; then
	SEQ_TODO=""
	[ -f "$GIT_DIR_PATH/sequencer/todo" ] && IFS= read -r SEQ_TODO < "$GIT_DIR_PATH/sequencer/todo"
	case "$SEQ_TODO" in revert\\ *) ;; *) exit 0 ;; esac
fi
` +
	// Per-repo opt-out the user owns, in git's native config (repo-local or --global).
	// --type=bool canonicalizes git's own synonyms (off/no/0/False all read as "false"), so the
	// opt-out follows the semantics a git user expects; unset or garbage keeps stamping on.
	`[ "$(git config --type=bool --get humanlayer.attribution)" = "false" ] && exit 0
` +
	// A message already carrying any humanlayer-session line is never stamped — this is what
	// keeps amend/cherry-pick-of-own-commit duplicate-free.
	`grep -qi '^humanlayer-session:' "$MSG_FILE" && exit 0
` +
	// The URL becomes a trailer LINE: reject non-printable bytes (an env value CAN carry a
	// newline, which would otherwise inject arbitrary message lines).
	`case "\${${SESSION_URL_ENV_VAR}}" in *[![:print:]]*) exit 0 ;; esac
` +
	// interpret-trailers gives real trailer-BLOCK semantics; -c pins separator/ifexists against
	// repo config that would otherwise mangle the value, and --no-divider stops an exact `---`
	// line in the body (markdown rules, pasted frontmatter) from being read as a patch divider —
	// without it the trailer lands MID-message, above the divider. Output goes to a same-dir
	// temp file and replaces the message only when fully written and non-empty — a git failure
	// can never leave a truncated message.
	`TMP="$MSG_FILE.humanlayer.$$"
if git -c trailer.separators=: -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add interpret-trailers --no-divider --trailer "${SESSION_TRAILER_TOKEN}: \${${SESSION_URL_ENV_VAR}}" "$MSG_FILE" >"$TMP" && [ -s "$TMP" ]; then
	mv -f "$TMP" "$MSG_FILE"
fi
rm -f "$TMP"
exit 0
`

/** hooks-path entry (`prepare-commit-msg`): chain the shadowed repo hook, then stamp. */
export const STAMPER = STAMPER_HEADER + CHAIN_REPO_HOOK + STAMP_BODY

/**
 * config-hooks entry (`stamp-commit-msg`): stamp only — registration is additive and git runs
 * the repo's hookdir hook natively AFTER configured hooks; chaining here would run it twice.
 */
export const CONFIG_STAMPER = STAMPER_HEADER + STAMP_BODY
