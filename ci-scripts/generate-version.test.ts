import { describe, test, expect, afterAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('ci-scripts/generate-version.ts')
function run(env: Record<string, string>, cwd: string = process.cwd()) {
  // Strip inherited INPUT_* vars, keep PATH and HOME for bun and git to work
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
  }
  for (const [k, v] of Object.entries(env)) {
    cleanEnv[k] = v
  }
  return execSync(`bun run "${SCRIPT}"`, {
    encoding: 'utf-8',
    cwd,
    env: cleanEnv,
  })
}

function parseOutput(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .map((line) => {
        const eq = line.indexOf('=')
        return [line.slice(0, eq), line.slice(eq + 1)]
      }),
  )
}

// ── Fixture repos for derived-version tests ──
// The release version is derived from git history (commits since the base
// version in tauri.conf.json last changed), so these tests build small git
// repos with known histories instead of relying on the live repo's history.

const fixtureDirs: string[] = []

afterAll(() => {
  for (const dir of fixtureDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(dir: string, ...args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
}

function commit(dir: string, message: string) {
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-m', message, '--no-gpg-sign')
}

function writeConf(dir: string, version: string, extra: Record<string, string> = {}) {
  writeFileSync(
    join(dir, 'apps/riptide-native/tauri.conf.json'),
    `${JSON.stringify({ productName: 'Fixture', version, ...extra }, null, 2)}\n`,
  )
}

function initFixture(baseVersion = '0.1.0'): string {
  const dir = mkdtempSync(join(tmpdir(), 'generate-version-'))
  fixtureDirs.push(dir)
  mkdirSync(join(dir, 'apps/riptide-native'), { recursive: true })
  git(dir, 'init', '-b', 'main')
  writeConf(dir, baseVersion)
  commit(dir, 'add config')
  return dir
}

function commitUnrelatedChange(dir: string, message: string) {
  writeFileSync(join(dir, 'other.txt'), message)
  commit(dir, message)
}

describe('generate-version', () => {
  describe('derived version (all channels)', () => {
    test('release at the base-introducing commit is the base itself', () => {
      const dir = initFixture('0.1.0')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'dev' }, dir))
      expect(out.release_version).toBe('0.1.0')
    })

    test('adds one patch per commit since the base version changed', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      commitUnrelatedChange(dir, 'second change')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'dev' }, dir))
      expect(out.release_version).toBe('0.1.2')
    })

    test('changing the base version resets the count', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      writeConf(dir, '0.2.0')
      commit(dir, 'bump base to 0.2.0')
      expect(parseOutput(run({ INPUT_RELEASE_TYPE: 'dev' }, dir)).release_version).toBe('0.2.0')

      commitUnrelatedChange(dir, 'after bump')
      expect(parseOutput(run({ INPUT_RELEASE_TYPE: 'dev' }, dir)).release_version).toBe('0.2.1')
    })

    test('non-version edits to tauri.conf.json do not reset the count', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      writeConf(dir, '0.1.0', { identifier: 'com.fixture.app' })
      commit(dir, 'edit config without touching version')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'dev' }, dir))
      expect(out.release_version).toBe('0.1.2')
    })

    test('beta derives the same way as dev', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'beta' }, dir))
      expect(out.release_version).toBe('0.1.1')
      expect(out.release_tag).toMatch(/^riptide-beta-v0\.1\.1-\d{14}$/)
    })

    test('prod derives the same version as dev and beta', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      commitUnrelatedChange(dir, 'second change')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'prod' }, dir))
      expect(out.release_version).toBe('0.1.2')
      expect(out.release_tag).toBe('riptide-v0.1.2')
    })

    test('errors when the base version is not plain x.y.z', () => {
      const dir = initFixture('0.1.0-beta.1')
      expect(() => run({ INPUT_RELEASE_TYPE: 'dev' }, dir)).toThrow()
    })

    test('errors when the working-tree version was never committed', () => {
      const dir = initFixture('0.1.0')
      writeConf(dir, '0.9.9')
      expect(() => run({ INPUT_RELEASE_TYPE: 'dev' }, dir)).toThrow()
    })
  })

  describe('dev release', () => {
    test('uses explicit version when provided', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.release_version).toBe('1.5.0')
    })

    test('generates timestamped release tag', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.release_tag).toMatch(/^riptide-dev-v1\.5\.0-\d{14}$/)
    })

    test('produces correct dmg filename and variant', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.dmg_filename).toBe('Riptide-Dev-darwin-arm64.dmg')
      expect(out.canonical_dmg_filename).toBe('HumanLayer-Dev.dmg')
      expect(out.dmg_variant).toBe('Dev')
    })

    test('produces correct updater artifact name', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.updater_artifact_name).toBe('Riptide-Dev.app.tar.gz')
    })

    test('sets release_type', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.release_type).toBe('dev')
    })
  })

  describe('beta release', () => {
    test('uses explicit version when provided', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'beta', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.release_version).toBe('1.5.0')
      expect(out.release_tag).toMatch(/^riptide-beta-v1\.5\.0-\d{14}$/)
    })

    test('produces correct dmg filename and variant', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'beta', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.dmg_filename).toBe('Riptide-Beta-darwin-arm64.dmg')
      expect(out.canonical_dmg_filename).toBe('HumanLayer-Beta.dmg')
      expect(out.dmg_variant).toBe('Beta')
    })

    test('produces correct updater artifact name', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'beta', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(out.updater_artifact_name).toBe('Riptide-Beta.app.tar.gz')
    })
  })

  describe('prod release', () => {
    test('derives the version from the current commit', () => {
      const dir = initFixture('0.1.0')
      commitUnrelatedChange(dir, 'first change')
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'prod' }, dir))
      expect(out.release_version).toBe('0.1.1')
      expect(out.release_tag).toBe('riptide-v0.1.1')
    })

    test('uses explicit version', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'prod', INPUT_RELEASE_VERSION: '2.0.0' }),
      )
      expect(out.release_version).toBe('2.0.0')
      expect(out.release_tag).toBe('riptide-v2.0.0')
    })

    test('produces correct dmg filename', () => {
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'prod', INPUT_RELEASE_VERSION: '2.0.0' }))
      expect(out.dmg_filename).toBe('Riptide-darwin-arm64.dmg')
      expect(out.canonical_dmg_filename).toBe('HumanLayer.dmg')
      expect(out.dmg_variant).toBe('Stable')
    })

    test('produces correct updater artifact name', () => {
      const out = parseOutput(run({ INPUT_RELEASE_TYPE: 'prod', INPUT_RELEASE_VERSION: '2.0.0' }))
      expect(out.updater_artifact_name).toBe('Riptide.app.tar.gz')
    })
  })

  describe('error handling', () => {
    test('errors when INPUT_RELEASE_TYPE is missing', () => {
      expect(() => run({})).toThrow()
    })

    test('errors when INPUT_RELEASE_TYPE is invalid', () => {
      expect(() => run({ INPUT_RELEASE_TYPE: 'staging' })).toThrow()
    })
  })

  describe('output format', () => {
    test('outputs all expected keys', () => {
      const out = parseOutput(
        run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' }),
      )
      expect(Object.keys(out).sort()).toEqual([
        'canonical_dmg_filename',
        'dmg_filename',
        'dmg_variant',
        'release_tag',
        'release_type',
        'release_version',
        'updater_artifact_name',
      ])
    })

    test('each line is key=value format', () => {
      const stdout = run({ INPUT_RELEASE_TYPE: 'dev', INPUT_RELEASE_VERSION: '1.5.0' })
      for (const line of stdout.trim().split('\n')) {
        expect(line).toMatch(/^[a-z_]+=.+$/)
      }
    })
  })
})
