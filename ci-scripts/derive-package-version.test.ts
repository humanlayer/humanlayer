import { describe, test, expect, afterAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('ci-scripts/derive-package-version.ts')

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

function writePackageJson(dir: string, version: string) {
  writeFileSync(
    join(dir, 'apps/some-cli/package.json'),
    `${JSON.stringify({ name: '@fixture/some-cli', version }, null, 2)}\n`,
  )
}

function initFixture(baseVersion = '0.1.0'): string {
  const dir = mkdtempSync(join(tmpdir(), 'derive-package-version-'))
  fixtureDirs.push(dir)
  mkdirSync(join(dir, 'apps/some-cli'), { recursive: true })
  mkdirSync(join(dir, 'apps/unrelated'), { recursive: true })
  git(dir, 'init', '-b', 'main')
  writePackageJson(dir, baseVersion)
  commit(dir, 'add package')
  return dir
}

function run(env: Record<string, string>, cwd: string): string {
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
  }
  for (const [k, v] of Object.entries(env)) {
    cleanEnv[k] = v
  }
  return execSync(`bun run "${SCRIPT}"`, { encoding: 'utf-8', cwd, env: cleanEnv }).trim()
}

const ENV = { VERSION_FILE: 'apps/some-cli/package.json', COUNT_PATHS: 'apps/some-cli' }

describe('derive-package-version', () => {
  test('version at the base-introducing commit is the base itself', () => {
    const dir = initFixture('0.1.0')
    expect(run(ENV, dir)).toBe('0.1.0')
  })

  test('only commits touching COUNT_PATHS increment the version', () => {
    const dir = initFixture('0.1.0')
    writeFileSync(join(dir, 'apps/some-cli/index.ts'), 'export {}')
    commit(dir, 'cli change')
    writeFileSync(join(dir, 'apps/unrelated/readme.md'), 'unrelated')
    commit(dir, 'unrelated change')
    writeFileSync(join(dir, 'apps/some-cli/index.ts'), 'export const x = 1')
    commit(dir, 'second cli change')
    expect(run(ENV, dir)).toBe('0.1.2')
  })

  test('changing the base version resets the count', () => {
    const dir = initFixture('0.1.0')
    writeFileSync(join(dir, 'apps/some-cli/index.ts'), 'export {}')
    commit(dir, 'cli change')
    writePackageJson(dir, '0.2.0')
    commit(dir, 'bump base to 0.2.0')
    expect(run(ENV, dir)).toBe('0.2.0')

    writeFileSync(join(dir, 'apps/some-cli/index.ts'), 'export const x = 1')
    commit(dir, 'cli change after bump')
    expect(run(ENV, dir)).toBe('0.2.1')
  })

  test('multiple COUNT_PATHS are all counted', () => {
    const dir = initFixture('0.1.0')
    writeFileSync(join(dir, 'apps/unrelated/readme.md'), 'now counted')
    commit(dir, 'change in second counted path')
    const out = run({ ...ENV, COUNT_PATHS: 'apps/some-cli apps/unrelated' }, dir)
    expect(out).toBe('0.1.1')
  })

  test('errors when VERSION_FILE is missing', () => {
    const dir = initFixture('0.1.0')
    expect(() => run({ COUNT_PATHS: 'apps/some-cli' }, dir)).toThrow()
  })

  test('errors when COUNT_PATHS is missing', () => {
    const dir = initFixture('0.1.0')
    expect(() => run({ VERSION_FILE: 'apps/some-cli/package.json' }, dir)).toThrow()
  })

  test('errors when a COUNT_PATHS entry does not exist (typo guard)', () => {
    const dir = initFixture('0.1.0')
    expect(() => run({ ...ENV, COUNT_PATHS: 'apps/some-cli apps/typo-cli' }, dir)).toThrow()
  })
})
