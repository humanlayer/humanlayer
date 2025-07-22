import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  ConfigManager,
  resolveFullConfig,
  resolveConfigWithSources,
  maskSensitiveValue,
} from './configV2'

// Mock fs module
vi.mock('fs')
vi.mock('path')

describe('ConfigManager', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }

    // Reset ConfigManager singleton
    ConfigManager.reset()

    // Setup mocks
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))
    vi.mocked(path.resolve).mockImplementation(p => p)
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('Configuration Resolution', () => {
    it('should use default values when nothing is configured', () => {
      const config = resolveFullConfig()

      expect(config.api_key).toBeUndefined()
      expect(config.api_base_url).toBe('https://api.humanlayer.dev/humanlayer/v1')
      expect(config.app_base_url).toBe('https://app.humanlayer.dev')
      expect(config.daemon_socket).toContain('daemon.sock')
      expect(config.run_id).toBeUndefined()
      expect(config.contact_channel).toEqual({})
    })

    it('should prioritize flags over all other sources', () => {
      process.env.HUMANLAYER_API_KEY = 'env-key'
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'file-key',
        }),
      )

      const config = resolveFullConfig({
        apiKey: 'flag-key',
      })

      expect(config.api_key).toBe('flag-key')
    })

    it('should prioritize environment variables over config file', () => {
      process.env.HUMANLAYER_API_KEY = 'env-key'
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'file-key',
        }),
      )

      const config = resolveFullConfig()

      expect(config.api_key).toBe('env-key')
    })

    it('should load from config file when no env or flags', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'file-key',
          api_base_url: 'https://custom.api.com',
        }),
      )

      const config = resolveFullConfig()

      expect(config.api_key).toBe('file-key')
      expect(config.api_base_url).toBe('https://custom.api.com')
    })

    it('should expand home directory in daemon socket path', () => {
      process.env.HOME = '/home/user'
      const manager = ConfigManager.getInstance()

      // Access private method through any type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expanded = (manager as any).expandPath('~/test/path')

      expect(expanded).toBe('/home/user/test/path')
    })
  })

  describe('Configuration Sources', () => {
    it('should track configuration sources correctly', () => {
      process.env.HUMANLAYER_API_KEY = 'env-key'
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_base_url: 'https://file.api.com',
        }),
      )

      const sources = resolveConfigWithSources({
        appBase: 'https://flag.app.com',
      })

      expect(sources.api_key).toEqual({
        value: 'env-key',
        source: 'env',
        sourceName: 'HUMANLAYER_API_KEY',
      })

      expect(sources.api_base_url).toEqual({
        value: 'https://file.api.com',
        source: 'config',
        sourceName: 'config file',
      })

      expect(sources.app_base_url).toEqual({
        value: 'https://flag.app.com',
        source: 'flag',
        sourceName: '--appBase',
      })

      expect(sources.daemon_socket.source).toBe('default')
    })
  })

  describe('Contact Channel Resolution', () => {
    it('should resolve Slack configuration from multiple sources', () => {
      process.env.HUMANLAYER_SLACK_CHANNEL = 'env-channel'
      process.env.HUMANLAYER_SLACK_BLOCKS = 'true'

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          channel: {
            slack: {
              bot_token: 'file-token',
              context_about_channel_or_user: 'file-context',
            },
          },
        }),
      )

      const config = resolveFullConfig({
        slackThreadTs: 'flag-thread',
      })

      expect(config.contact_channel.slack).toEqual({
        channel_or_user_id: 'env-channel',
        bot_token: 'file-token',
        context_about_channel_or_user: 'file-context',
        thread_ts: 'flag-thread',
        experimental_slack_blocks: true,
      })
    })

    it('should resolve Email configuration correctly', () => {
      process.env.HUMANLAYER_EMAIL_ADDRESS = 'test@example.com'

      const config = resolveFullConfig({
        emailContext: 'Test user',
      })

      expect(config.contact_channel.email).toEqual({
        address: 'test@example.com',
        context_about_user: 'Test user',
      })
    })
  })

  describe('Caching', () => {
    it('should cache loaded config files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'test-key',
        }),
      )

      // First call
      resolveFullConfig()
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)

      // Second call should use cache
      resolveFullConfig()
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    })

    it('should cache resolved configurations', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'test-key',
        }),
      )

      const manager = ConfigManager.getInstance()

      // First resolve
      const config1 = manager.resolve()

      // Second resolve should return same object
      const config2 = manager.resolve()

      expect(config1).toBe(config2)
    })

    it('should use different cache keys for different config files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify({ api_key: 'key1' }))
        .mockReturnValueOnce(JSON.stringify({ api_key: 'key2' }))

      const config1 = resolveFullConfig({ configFile: 'config1.json' })
      const config2 = resolveFullConfig({ configFile: 'config2.json' })

      expect(config1.api_key).toBe('key1')
      expect(config2.api_key).toBe('key2')
      expect(fs.readFileSync).toHaveBeenCalledTimes(2)
    })
  })

  describe('Validation', () => {
    it('should validate URL fields', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_base_url: 'not-a-url',
        }),
      )

      expect(() => resolveFullConfig()).toThrow(
        'Invalid value for api_base_url in config file: not-a-url',
      )
    })

    it('should validate config structure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('null')

      expect(() => resolveFullConfig()).toThrow('Cannot read properties of null')
    })

    it('should validate flag values', () => {
      expect(() =>
        resolveFullConfig({
          apiBase: 'not-a-url',
        }),
      ).toThrow('Invalid value for api_base_url')
    })
  })

  describe('Config Saving', () => {
    it('should save config to file', () => {
      const writeFileSyncMock = vi.mocked(fs.writeFileSync)
      const manager = ConfigManager.getInstance()

      const config = {
        api_key: 'test-key',
        channel: {
          slack: {
            channel_or_user_id: 'C123',
          },
        },
      }

      manager.saveConfig(config)

      expect(writeFileSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('humanlayer.json'),
        JSON.stringify(config, null, 2),
      )
    })

    it('should clear caches after saving', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'old-key',
        }),
      )

      const manager = ConfigManager.getInstance()

      // Load config to populate cache
      const config1 = manager.resolve()
      expect(config1.api_key).toBe('old-key')

      // Save new config
      manager.saveConfig({ api_key: 'new-key' })

      // Mock new file content
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          api_key: 'new-key',
        }),
      )

      // Should reload from file
      const config2 = manager.resolve()
      expect(config2.api_key).toBe('new-key')
    })
  })

  describe('Utility Functions', () => {
    it('should mask sensitive values correctly', () => {
      expect(maskSensitiveValue(undefined)).toBe('<not set>')
      expect(maskSensitiveValue('short')).toBe('short...')
      expect(maskSensitiveValue('longsecretvalue')).toBe('longse...')
    })
  })

  describe('Error Handling', () => {
    it('should handle JSON parse errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json')

      // Should not throw, just use defaults
      const config = resolveFullConfig()
      expect(config.api_base_url).toBe('https://api.humanlayer.dev/humanlayer/v1')
    })

    it('should throw for specific config file with invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json')

      expect(() => resolveFullConfig({ configFile: 'specific.json' })).toThrow(
        'Failed to load config from specific.json',
      )
    })
  })

  describe('Thoughts Configuration', () => {
    it('should load thoughts config from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          thoughts: {
            thoughtsRepo: '~/thoughts',
            reposDir: 'repos',
            globalDir: 'global',
            user: 'testuser',
            repoMappings: {},
          },
        }),
      )

      const config = resolveFullConfig()

      expect(config.thoughts).toEqual({
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'testuser',
        repoMappings: {},
      })
    })
  })
})
