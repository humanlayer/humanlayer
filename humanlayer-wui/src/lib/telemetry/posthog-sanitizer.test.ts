import { describe, test, expect } from 'bun:test'
import { sanitizeEventProperties, sanitizeUrl } from './posthog-sanitizer'

describe('PostHog Sanitizer', () => {
  describe('sanitizeEventProperties', () => {
    test('only keeps whitelisted keys', () => {
      const input = {
        api_key: 'sk-abc123', // Not whitelisted - should be filtered
        model: 'claude-3-5-sonnet', // Whitelisted - should be kept
        prompt: 'user prompt', // Not whitelisted - should be filtered
        count: 5, // Whitelisted - should be kept
      }

      const output = sanitizeEventProperties(input)

      expect(output.api_key).toBeUndefined() // Filtered entirely
      expect(output.model).toBe('claude-3-5-sonnet')
      expect(output.prompt).toBeUndefined() // Filtered entirely
      expect(output.count).toBe(5)
    })

    test('filters nested objects if parent key is not whitelisted', () => {
      const input = {
        model: 'claude-3-5-sonnet',
        metadata: {
          // metadata is not whitelisted, so entire object is filtered
          provider: 'anthropic',
          api_key: 'sk-123',
          count: 5,
        },
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBe('claude-3-5-sonnet')
      // metadata is not whitelisted, so the entire nested object is filtered
      expect(output.metadata).toBeUndefined()
    })

    test('filters file paths even in whitelisted keys', () => {
      const input = {
        model: '/Users/john/project/file.txt', // Whitelisted key but contains path
        provider: '/home/user/secret', // Whitelisted key but contains path
        count: 5, // Safe value
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBeUndefined() // Filtered entirely
      expect(output.provider).toBeUndefined() // Filtered entirely
      expect(output.count).toBe(5)
    })

    test('filters Windows paths in whitelisted keys', () => {
      const input = {
        model: 'C:\\Users\\john\\project\\file.txt',
        count: 5,
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBeUndefined()
      expect(output.count).toBe(5)
    })

    test('filters potential secrets even in whitelisted keys', () => {
      const input = {
        model: 'sk-abc123def456ghi789jkl012mno345pqr678', // Looks like a secret (>30 chars, few dashes)
        provider: 'anthropic', // Normal value
        app_version: '1.0.0', // Normal value
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBeUndefined() // Filtered entirely
      expect(output.provider).toBe('anthropic')
      expect(output.app_version).toBe('1.0.0')
    })

    test('keeps normal short strings in whitelisted keys', () => {
      const input = {
        model: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        build_type: 'nightly',
        platform: 'desktop',
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBe('claude-3-5-sonnet-20241022')
      expect(output.provider).toBe('anthropic')
      expect(output.build_type).toBe('nightly')
      expect(output.platform).toBe('desktop')
    })

    test('filters deeply nested objects if parent keys not whitelisted', () => {
      const input = {
        model: 'claude',
        deep: {
          // 'deep' is not whitelisted, so entire structure is filtered
          nested: {
            provider: 'anthropic',
            secret: 'should-not-appear',
            count: 3,
          },
        },
      }

      const output = sanitizeEventProperties(input)

      expect(output.model).toBe('claude')
      // 'deep' is not whitelisted, so the entire nested structure is filtered
      expect(output.deep).toBeUndefined()
    })

    test('prevents infinite recursion with depth limit', () => {
      // Create a deeply nested object
      let input: any = { model: 'claude' }
      let current = input
      for (let i = 0; i < 20; i++) {
        current.nested = { count: i }
        current = current.nested
      }

      // Should not throw, should stop at depth limit
      const output = sanitizeEventProperties(input)
      expect(output.model).toBe('claude')
    })

    test('keeps boolean values', () => {
      const input = {
        feature_enabled: true,
        setting_enabled: false,
        provider: 'anthropic',
      }

      const output = sanitizeEventProperties(input)

      expect(output.feature_enabled).toBe(true)
      expect(output.setting_enabled).toBe(false)
      expect(output.provider).toBe('anthropic')
    })

    test('keeps numeric values', () => {
      const input = {
        count: 42,
        duration_ms: 1234,
        startup_time_ms: 567,
        timestamp: Date.now(),
      }

      const output = sanitizeEventProperties(input)

      expect(output.count).toBe(42)
      expect(output.duration_ms).toBe(1234)
      expect(output.startup_time_ms).toBe(567)
      expect(output.timestamp).toBeDefined()
    })

    test('handles PostHog standard properties', () => {
      const input = {
        $current_url: 'https://example.com',
        $host: 'example.com',
        $pathname: '/settings',
        $pageview: true,
      }

      const output = sanitizeEventProperties(input)

      expect(output.$current_url).toBe('https://example.com')
      expect(output.$host).toBe('example.com')
      expect(output.$pathname).toBe('/settings')
      expect(output.$pageview).toBe(true)
    })

    test('filters all common sensitive keys', () => {
      const input = {
        api_key: 'secret',
        token: 'secret',
        password: 'secret',
        secret: 'secret',
        prompt: 'user input',
        message: 'user message',
        file_path: '/path/to/file',
        working_directory: '/home/user',
        session_id: 'session123',
        user_id: 'user456',
        model: 'claude', // This IS whitelisted
      }

      const output = sanitizeEventProperties(input)

      // Only model should remain
      expect(Object.keys(output)).toEqual(['model'])
      expect(output.model).toBe('claude')
    })

    test('handles empty objects', () => {
      const input = {}
      const output = sanitizeEventProperties(input)
      expect(output).toEqual({})
    })

    test('case-insensitive key matching', () => {
      const input = {
        Model: 'claude',
        PROVIDER: 'anthropic',
        Count: 5,
      }

      const output = sanitizeEventProperties(input)

      expect(output.Model).toBe('claude')
      expect(output.PROVIDER).toBe('anthropic')
      expect(output.Count).toBe(5)
    })
  })

  describe('sanitizeUrl', () => {
    test('only keeps whitelisted query parameters', () => {
      const input = 'https://example.com?api_key=secret&page_name=home'
      const output = sanitizeUrl(input)

      // api_key is not whitelisted, page_name is whitelisted
      expect(output).toBe('https://example.com/?page_name=home')
    })

    test('removes all non-whitelisted parameters', () => {
      const input = 'https://example.com?api_key=secret&token=xyz&model=claude&provider=anthropic'
      const output = sanitizeUrl(input)

      // Only model and provider are whitelisted
      const url = new URL(output)
      expect(url.searchParams.has('api_key')).toBe(false)
      expect(url.searchParams.has('token')).toBe(false)
      expect(url.searchParams.get('model')).toBe('claude')
      expect(url.searchParams.get('provider')).toBe('anthropic')
    })

    test('preserves URL structure without parameters', () => {
      const input = 'https://example.com/path/to/page?session=123'
      const output = sanitizeUrl(input)

      const url = new URL(output)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('example.com')
      expect(url.pathname).toBe('/path/to/page')
      expect(url.searchParams.has('session')).toBe(false)
    })

    test('handles URLs with no query parameters', () => {
      const input = 'https://example.com/page'
      const output = sanitizeUrl(input)

      expect(output).toBe('https://example.com/page')
    })

    test('handles invalid URLs gracefully', () => {
      const input = 'not-a-valid-url'
      const output = sanitizeUrl(input)

      expect(output).toBe('[INVALID_URL]')
    })

    test('handles URLs with fragments', () => {
      const input = 'https://example.com?model=claude&token=secret#section'
      const output = sanitizeUrl(input)

      const url = new URL(output)
      expect(url.searchParams.get('model')).toBe('claude')
      expect(url.searchParams.has('token')).toBe(false)
      expect(url.hash).toBe('#section')
    })

    test('case-insensitive parameter matching', () => {
      const input = 'https://example.com?Model=claude&API_KEY=secret'
      const output = sanitizeUrl(input)

      const url = new URL(output)
      expect(url.searchParams.get('Model')).toBe('claude')
      expect(url.searchParams.has('API_KEY')).toBe(false)
    })
  })
})
