/**
 * @jest-environment jsdom
 */

import {
  THEME_STORAGE_KEY,
  RESPONSE_INPUT_STORAGE_KEY,
  LAST_WORKING_DIR_KEY,
  SESSION_LAUNCHER_QUERY_KEY,
  DEMO_PREFERENCES_KEY,
  getSessionResponseInputKey,
  getBrainrotModeKey,
  getStorageItem,
  setStorageItem,
  removeStorageItem,
} from './storage-keys'

describe('Storage Keys', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
  })

  describe('Storage Key Constants', () => {
    test('should export all expected storage keys', () => {
      expect(THEME_STORAGE_KEY).toBeDefined()
      expect(RESPONSE_INPUT_STORAGE_KEY).toBeDefined()
      expect(LAST_WORKING_DIR_KEY).toBeDefined()
      expect(SESSION_LAUNCHER_QUERY_KEY).toBeDefined()
      expect(DEMO_PREFERENCES_KEY).toBeDefined()
    })

    test('should have consistent key naming', () => {
      expect(THEME_STORAGE_KEY).toBe('wui-theme')
      expect(RESPONSE_INPUT_STORAGE_KEY).toBe('response-input')
      expect(LAST_WORKING_DIR_KEY).toBe('humanlayer-last-working-dir')
      expect(SESSION_LAUNCHER_QUERY_KEY).toBe('session-launcher-query')
      expect(DEMO_PREFERENCES_KEY).toBe('wui-demo-preferences')
    })
  })

  describe('Key Generation Functions', () => {
    test('getSessionResponseInputKey should generate correct keys', () => {
      expect(getSessionResponseInputKey('session-123')).toBe('response-input.session-123')
      expect(getSessionResponseInputKey('test-session')).toBe('response-input.test-session')
    })

    test('getBrainrotModeKey should generate correct keys', () => {
      expect(getBrainrotModeKey('session-123')).toBe('brainrot-mode-session-123')
      expect(getBrainrotModeKey('test-session')).toBe('brainrot-mode-test-session')
    })
  })

  describe('Storage Utilities', () => {
    describe('getStorageItem', () => {
      test('should retrieve stored values', () => {
        localStorage.setItem('test-key', 'test-value')
        expect(getStorageItem('test-key')).toBe('test-value')
      })

      test('should return fallback for missing keys', () => {
        expect(getStorageItem('missing-key', 'default')).toBe('default')
      })

      test('should return empty string as default fallback', () => {
        expect(getStorageItem('missing-key')).toBe('')
      })

      test('should handle localStorage errors gracefully', () => {
        // Mock localStorage to throw an error
        const originalGetItem = localStorage.getItem
        localStorage.getItem = jest.fn().mockImplementation(() => {
          throw new Error('Storage not available')
        })

        expect(getStorageItem('any-key', 'fallback')).toBe('fallback')

        // Restore original method
        localStorage.getItem = originalGetItem
      })
    })

    describe('setStorageItem', () => {
      test('should store values in localStorage', () => {
        setStorageItem('test-key', 'test-value')
        expect(localStorage.getItem('test-key')).toBe('test-value')
      })

      test('should handle localStorage errors gracefully', () => {
        // Mock localStorage to throw an error
        const originalSetItem = localStorage.setItem
        localStorage.setItem = jest.fn().mockImplementation(() => {
          throw new Error('Storage not available')
        })

        // Should not throw an error
        expect(() => setStorageItem('test-key', 'test-value')).not.toThrow()

        // Restore original method
        localStorage.setItem = originalSetItem
      })
    })

    describe('removeStorageItem', () => {
      test('should remove items from localStorage', () => {
        localStorage.setItem('test-key', 'test-value')
        expect(localStorage.getItem('test-key')).toBe('test-value')

        removeStorageItem('test-key')
        expect(localStorage.getItem('test-key')).toBeNull()
      })

      test('should handle localStorage errors gracefully', () => {
        // Mock localStorage to throw an error
        const originalRemoveItem = localStorage.removeItem
        localStorage.removeItem = jest.fn().mockImplementation(() => {
          throw new Error('Storage not available')
        })

        // Should not throw an error
        expect(() => removeStorageItem('test-key')).not.toThrow()

        // Restore original method
        localStorage.removeItem = originalRemoveItem
      })
    })
  })

  describe('Integration Tests', () => {
    test('should work with theme storage operations', () => {
      setStorageItem(THEME_STORAGE_KEY, 'dark-mode')
      expect(getStorageItem(THEME_STORAGE_KEY)).toBe('dark-mode')

      removeStorageItem(THEME_STORAGE_KEY)
      expect(getStorageItem(THEME_STORAGE_KEY, 'light-mode')).toBe('light-mode')
    })

    test('should work with session response input keys', () => {
      const sessionId = 'session-456'
      const key = getSessionResponseInputKey(sessionId)
      const value = 'user input content'

      setStorageItem(key, value)
      expect(getStorageItem(key)).toBe(value)

      removeStorageItem(key)
      expect(getStorageItem(key)).toBe('')
    })

    test('should work with brainrot mode keys', () => {
      const sessionId = 'session-789'
      const key = getBrainrotModeKey(sessionId)

      setStorageItem(key, 'true')
      expect(getStorageItem(key)).toBe('true')

      removeStorageItem(key)
      expect(getStorageItem(key)).toBe('')
    })
  })
})