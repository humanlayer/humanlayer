/**
 * Shared derivation logic for build-time package versions.
 *
 * The version committed in a package's version file is a *base*; the released
 * version is base patch + the number of first-parent commits since that base
 * was introduced. PRs never commit version bumps (that used to make every
 * pair of open PRs conflict on the version files), yet every release gets a
 * strictly increasing, deterministic-per-commit version.
 *
 * With countPaths set, only commits touching those paths count — right for
 * packages that publish only when their files change (the npm CLIs). Without
 * it, every commit counts — right for riptide-native, which cuts a dev build
 * on every merge to main.
 *
 * Consumed by generate-version.ts (riptide) and derive-package-version.ts
 * (npm CLIs).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface DeriveVersionOptions {
  /** Repo-relative path to a JSON file with a top-level "version" field */
  versionFile: string
  /** Only first-parent commits touching these paths count (default: all commits) */
  countPaths?: string[]
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function versionAtCommit(sha: string, versionFile: string): string | null {
  try {
    return JSON.parse(git('show', `${sha}:${versionFile}`)).version ?? null
  } catch {
    return null
  }
}

export function deriveVersion({ versionFile, countPaths }: DeriveVersionOptions): string {
  const base = JSON.parse(readFileSync(resolve(versionFile), 'utf-8')).version
  const match = typeof base === 'string' ? base.match(/^(\d+)\.(\d+)\.(\d+)$/) : null
  if (!match) {
    throw new Error(`version in ${versionFile} must be plain x.y.z to derive from (got '${base}')`)
  }

  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('cannot derive a version from a shallow clone — check out with fetch-depth: 0')
  }

  // Walk first-parent commits that touched the version file, newest first.
  // The oldest one still carrying the current base version is the commit that
  // introduced it; edits to other fields keep the count running.
  const history = git('log', '--first-parent', '--format=%H', '--', versionFile)
    .split('\n')
    .filter(Boolean)
  let introducedBy: string | null = null
  for (const sha of history) {
    if (versionAtCommit(sha, versionFile) === base) {
      introducedBy = sha
    } else {
      break
    }
  }
  if (!introducedBy) {
    throw new Error(`no commit in history carries version ${base} — is ${versionFile} modified but not committed?`)
  }

  const countArgs = ['rev-list', '--count', '--first-parent', `${introducedBy}..HEAD`]
  if (countPaths && countPaths.length > 0) {
    // A typo'd or renamed path would count 0 commits and silently re-derive
    // an already-released version (npm then skips the publish) — fail loudly.
    for (const path of countPaths) {
      if (!existsSync(resolve(path))) {
        throw new Error(`countPaths entry '${path}' does not exist in the working tree`)
      }
    }
    countArgs.push('--', ...countPaths)
  }
  const commitsSinceBase = Number(git(...countArgs))

  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) + commitsSinceBase}`
}
