import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = 'ci-scripts/generate-homebrew-cask.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'homebrew-cask-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function run(env: Record<string, string>) {
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
  }
  for (const [k, v] of Object.entries(env)) {
    cleanEnv[k] = v
  }
  return execSync(`bun run ${SCRIPT}`, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: cleanEnv,
  })
}

function validEnv(
  releaseType: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const outputDir = join(tempDir, 'Casks')
  return {
    RELEASE_TYPE: releaseType,
    RELEASE_VERSION: '1.2.3',
    SHA256: 'abc123def456',
    DMG_URL:
      'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.2.3/Riptide-darwin-arm64.dmg',
    OUTPUT_DIR: outputDir,
    ...overrides,
  }
}

function readCask(outputPath: string): string {
  return readFileSync(outputPath, 'utf-8')
}

function legacyCaskPath(env: Record<string, string>): string {
  const slug = env.RELEASE_TYPE === 'prod' ? 'riptide' : `riptide-${env.RELEASE_TYPE}`
  return join(env.OUTPUT_DIR, `${slug}.rb`)
}

describe('generate-homebrew-cask', () => {
  describe('dev cask', () => {
    test('generates correct cask name', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('cask "riptide-dev"')
    })

    test('uses correct app name', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('name "Riptide-Dev"')
      expect(cask).toContain('app "HumanLayer-Dev.app", target: "Riptide-Dev.app"')
    })

    test('uses correct bundle identifier', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('com.humanlayer.riptide.dev')
    })

    test('uses correct daemon target', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('target: "riptided-dev"')
    })

    test('uses dev description', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('Development build of HumanLayer')
    })

    test('zap paths reference dev logs', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('riptide-dev-*.jsonl')
    })
  })

  describe('beta cask', () => {
    test('generates correct cask name', () => {
      const env = validEnv('beta')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('cask "riptide-beta"')
    })

    test('uses correct app name', () => {
      const env = validEnv('beta')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('name "Riptide-Beta"')
      expect(cask).toContain('app "HumanLayer-Beta.app", target: "Riptide-Beta.app"')
    })

    test('uses correct bundle identifier', () => {
      const env = validEnv('beta')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('com.humanlayer.riptide.beta')
    })

    test('uses correct daemon target', () => {
      const env = validEnv('beta')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('target: "riptided-beta"')
    })
  })

  describe('prod cask', () => {
    test('generates correct cask name', () => {
      const env = validEnv('prod')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('cask "riptide"')
      // Should NOT contain riptide-prod or riptide-dev
      expect(cask).not.toContain('cask "riptide-prod"')
    })

    test('uses correct app name', () => {
      const env = validEnv('prod')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('name "Riptide"')
      expect(cask).toContain('app "HumanLayer.app", target: "Riptide.app"')
    })

    test('uses correct bundle identifier', () => {
      const env = validEnv('prod')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('com.humanlayer.riptide.plist')
      expect(cask).toContain('com.humanlayer.riptide.savedState')
      // Should NOT have .dev or .beta variants
      expect(cask).not.toContain('com.humanlayer.riptide.dev')
      expect(cask).not.toContain('com.humanlayer.riptide.beta')
    })

    test('uses correct daemon target', () => {
      const env = validEnv('prod')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('target: "riptided"')
    })

    test('uses prod description', () => {
      const env = validEnv('prod')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('AI coding agent powered by Claude')
    })
  })

  describe('common fields', () => {
    test.each(['dev', 'beta', 'prod'])('omits deprecated verified metadata in both %s casks', (releaseType) => {
      const env = validEnv(releaseType)
      run(env)
      const suffix = releaseType === 'prod' ? '' : `-${releaseType}`
      for (const name of ['riptide', 'humanlayer']) {
        const cask = readCask(join(env.OUTPUT_DIR, `${name}${suffix}.rb`))
        expect(cask).toContain(`  url "${env.DMG_URL}"\n`)
        expect(cask).not.toContain('verified:')
        expect(cask).toContain(`sha256 "${env.SHA256}"`)
      }
    })

    test('includes version', () => {
      const env = validEnv('dev', { RELEASE_VERSION: '3.4.5' })
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('version "3.4.5"')
    })

    test('includes sha256', () => {
      const env = validEnv('dev', { SHA256: 'deadbeef1234' })
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('sha256 "deadbeef1234"')
    })

    test('includes dmg url', () => {
      const url = 'https://example.com/my.dmg'
      const env = validEnv('dev', { DMG_URL: url })
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain(`url "${url}"`)
    })

    test('declares auto_updates true', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(legacyCaskPath(env))
      expect(cask).toContain('auto_updates true')
    })

    test('includes binary with correct path pattern', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(join(env.OUTPUT_DIR, `riptide-${env.RELEASE_TYPE === 'prod' ? '' : `${env.RELEASE_TYPE}`}.rb`.replace('riptide-.rb', 'riptide.rb')))
      expect(cask).toContain(
        '#{appdir}/Riptide-Dev.app/Contents/Resources/bin/riptided',
      )
    })

    test('includes homepage', () => {
      const env = validEnv('dev')
      run(env)
      const cask = readCask(join(env.OUTPUT_DIR, `riptide-${env.RELEASE_TYPE === 'prod' ? '' : `${env.RELEASE_TYPE}`}.rb`.replace('riptide-.rb', 'riptide.rb')))
      expect(cask).toContain('homepage "https://humanlayer.dev/"')
    })
  })

  describe('stdout output', () => {
    test('outputs cask_path', () => {
      const env = validEnv('dev')
      const stdout = run(env)
      expect(stdout).toContain(`cask_path=${join(env.OUTPUT_DIR, 'riptide-dev.rb')}`)
    })
  })

  describe('output directory', () => {
    test('creates parent directories', () => {
      const outputDir = join(tempDir, 'a', 'b')
      const env = validEnv('dev', { OUTPUT_DIR: outputDir })
      run(env)
      const cask = readCask(join(outputDir, 'riptide-dev.rb'))
      expect(cask).toContain('cask "riptide-dev"')
    })
  })

  describe('error handling', () => {
    test('errors when RELEASE_TYPE is missing', () => {
      const env = validEnv('dev')
      delete (env as Record<string, string | undefined>).RELEASE_TYPE
      expect(() => run(env)).toThrow()
    })

    test('errors when RELEASE_VERSION is missing', () => {
      const env = validEnv('dev')
      delete (env as Record<string, string | undefined>).RELEASE_VERSION
      expect(() => run(env)).toThrow()
    })

    test('errors when SHA256 is missing', () => {
      const env = validEnv('dev')
      delete (env as Record<string, string | undefined>).SHA256
      expect(() => run(env)).toThrow()
    })

    test('errors when DMG_URL is missing', () => {
      const env = validEnv('dev')
      delete (env as Record<string, string | undefined>).DMG_URL
      expect(() => run(env)).toThrow()
    })

    test('errors when OUTPUT_DIR is missing', () => {
      const env = validEnv('dev')
      delete (env as Record<string, string | undefined>).OUTPUT_DIR
      expect(() => run(env)).toThrow()
    })

    test('errors when RELEASE_TYPE is invalid', () => {
      const env = validEnv('dev')
      env.RELEASE_TYPE = 'staging'
      expect(() => run(env)).toThrow()
    })
  })
})
