import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = 'ci-scripts/generate-updater-manifest.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'updater-manifest-test-'))
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

let sigFileCounter = 0
function createSigFile(content = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXk='): string {
  const sigPath = join(tempDir, `test-${sigFileCounter++}.sig`)
  writeFileSync(sigPath, content)
  return sigPath
}

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const sigPath = createSigFile()
  const outputPath = join(tempDir, 'output', 'latest.json')
  return {
    VERSION: '1.2.3',
    RELEASE_TAG: 'riptide-dev-v1.2.3-20260310120000',
    ARTIFACT_NAME: 'Riptide-Dev.app.tar.gz',
    SIGNATURE_FILE: sigPath,
    OUTPUT_PATH: outputPath,
    ...overrides,
  }
}

function readManifest(outputPath: string) {
  return JSON.parse(readFileSync(outputPath, 'utf-8'))
}

describe('generate-updater-manifest', () => {
  describe('happy path', () => {
    test('generates valid latest.json', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)

      expect(manifest.version).toBe('1.2.3')
      expect(manifest.platforms['darwin-aarch64']).toBeDefined()
      expect(manifest.platforms['darwin-aarch64'].signature).toBe(
        'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXk=',
      )
    })

    test('constructs correct artifact URL', () => {
      const env = validEnv({
        RELEASE_TAG: 'riptide-v2.0.0',
        ARTIFACT_NAME: 'Riptide.app.tar.gz',
      })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)

      expect(manifest.platforms['darwin-aarch64'].url).toBe(
        'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v2.0.0/Riptide.app.tar.gz',
      )
    })

    test('includes pub_date as ISO string', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)

      // Should be a valid ISO date string
      expect(() => new Date(manifest.pub_date)).not.toThrow()
      expect(manifest.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('optional fields', () => {
    test('defaults notes to empty string', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.notes).toBe('')
    })

    test('uses provided notes', () => {
      const env = validEnv({ NOTES: 'Bug fixes and improvements' })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.notes).toBe('Bug fixes and improvements')
    })

    test('preserves multi-line markdown notes verbatim', () => {
      const notes = [
        'Big improvements to the update flow.',
        '',
        '**Highlights**',
        '',
        '- **Markdown notes** — release notes now render as formatted Markdown',
        '- **Docs changelog** — the "View full changelog" link opens the docs site',
      ].join('\n')
      const env = validEnv({ NOTES: notes })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.notes).toBe(notes)
    })

    test('passes through explicit empty notes as empty string', () => {
      const env = validEnv({ NOTES: '' })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.notes).toBe('')
    })

    test('defaults urgency to normal', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.urgency).toBe('normal')
    })

    test('uses provided urgency', () => {
      const env = validEnv({ URGENCY: 'critical' })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.urgency).toBe('critical')
    })
  })

  describe('signature handling', () => {
    test('trims whitespace from signature file', () => {
      const sigPath = createSigFile('  some-signature-content  \n\n')
      const env = validEnv({ SIGNATURE_FILE: sigPath })
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(manifest.platforms['darwin-aarch64'].signature).toBe(
        'some-signature-content',
      )
    })
  })

  describe('output directory', () => {
    test('creates parent directories', () => {
      const outputPath = join(tempDir, 'a', 'b', 'c', 'latest.json')
      const env = validEnv({ OUTPUT_PATH: outputPath })
      run(env)
      const manifest = readManifest(outputPath)
      expect(manifest.version).toBe('1.2.3')
    })
  })

  describe('error handling', () => {
    test('errors when VERSION is missing', () => {
      const env = validEnv()
      delete (env as Record<string, string | undefined>).VERSION
      expect(() => run(env)).toThrow()
    })

    test('errors when RELEASE_TAG is missing', () => {
      const env = validEnv()
      delete (env as Record<string, string | undefined>).RELEASE_TAG
      expect(() => run(env)).toThrow()
    })

    test('errors when ARTIFACT_NAME is missing', () => {
      const env = validEnv()
      delete (env as Record<string, string | undefined>).ARTIFACT_NAME
      expect(() => run(env)).toThrow()
    })

    test('errors when SIGNATURE_FILE is missing', () => {
      const env = validEnv()
      delete (env as Record<string, string | undefined>).SIGNATURE_FILE
      expect(() => run(env)).toThrow()
    })

    test('errors when OUTPUT_PATH is missing', () => {
      const env = validEnv()
      delete (env as Record<string, string | undefined>).OUTPUT_PATH
      expect(() => run(env)).toThrow()
    })
  })

  describe('manifest structure', () => {
    test('has exactly the expected top-level keys', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(Object.keys(manifest).sort()).toEqual([
        'notes',
        'platforms',
        'pub_date',
        'urgency',
        'version',
      ])
    })

    test('platforms contains only darwin-aarch64', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64'])
    })

    test('platform entry has url and signature', () => {
      const env = validEnv()
      run(env)
      const manifest = readManifest(env.OUTPUT_PATH)
      const platform = manifest.platforms['darwin-aarch64']
      expect(Object.keys(platform).sort()).toEqual(['signature', 'url'])
    })
  })
})
