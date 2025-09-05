import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { HTTPDaemonClient } from './http-client'

// Mock the HLDClient
const mockHealth = mock(
  (): Promise<any> =>
    Promise.resolve({
      status: 'ok',
      version: '1.0.0',
    }),
)

mock.module('@humanlayer/hld-sdk', () => ({
  HLDClient: class MockHLDClient {
    health = mockHealth
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_options: any) {
      // Store options for testing if needed
    }
  },
}))

// Mock getDaemonUrl
mock.module('./http-config', () => ({
  getDaemonUrl: mock(() => Promise.resolve('http://localhost:7777')),
  getDefaultHeaders: mock(() => ({ 'X-Client': 'test' })),
}))

// Mock logger
mock.module('@/lib/logging', () => ({
  logger: {
    log: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  },
}))

describe('HTTPDaemonClient', () => {
  let client: HTTPDaemonClient

  beforeEach(() => {
    client = new HTTPDaemonClient()
    mockHealth.mockReset()
  })

  describe('connect', () => {
    test('should connect successfully when health status is "ok"', async () => {
      mockHealth.mockResolvedValueOnce({ status: 'ok', version: '1.0.0' })

      await expect(client.connect()).resolves.toBeUndefined()
    })

    test('should connect successfully when health status is "degraded"', async () => {
      // This is the key test - degraded status should be accepted
      mockHealth.mockResolvedValueOnce({ status: 'degraded', version: '1.0.0' })

      await expect(client.connect()).resolves.toBeUndefined()
    })

    test('should throw error when health status is neither "ok" nor "degraded"', async () => {
      mockHealth.mockResolvedValueOnce({ status: 'error', version: '1.0.0' })

      await expect(client.connect()).rejects.toThrow('Cannot connect to daemon')
    })

    test('should throw error when health check fails', async () => {
      mockHealth.mockRejectedValueOnce(new Error('Connection refused'))

      await expect(client.connect()).rejects.toThrow('Cannot connect to daemon')
    })

    test('should not reconnect if already connected', async () => {
      mockHealth.mockResolvedValueOnce({ status: 'ok', version: '1.0.0' })

      await client.connect()
      mockHealth.mockClear()

      // Second connect should not make another health check
      await client.connect()
      expect(mockHealth).not.toHaveBeenCalled()
    })

    test('should retry on connection failure', async () => {
      // Track call count manually
      let callCount = 0
      mockHealth.mockImplementation(() => {
        callCount++
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'))
        }
        return Promise.resolve({ status: 'ok', version: '1.0.0' })
      })

      await expect(client.connect()).resolves.toBeUndefined()
      expect(callCount).toBe(3)
    })

    test('should fail after max retries', async () => {
      // Fail all attempts
      mockHealth.mockRejectedValue(new Error('Connection refused'))

      await expect(client.connect()).rejects.toThrow('Cannot connect to daemon')
      // Should try 3 times (maxRetries = 3)
      expect(mockHealth).toHaveBeenCalledTimes(3)
    })
  })

  describe('health', () => {
    test('should return health status when connected', async () => {
      // Connect first
      mockHealth.mockResolvedValueOnce({ status: 'ok', version: '1.0.0' })
      await client.connect()

      // Now mock the health response with full structure
      mockHealth.mockResolvedValueOnce({
        status: 'degraded',
        version: '1.0.0',
        dependencies: {
          claude: {
            available: false,
            error: 'claude binary not found',
          },
        },
      })

      const health = await client.health()

      // The HTTP client only returns status and version
      expect(health).toEqual({
        status: 'degraded',
        version: '1.0.0',
      })
    })

    test('should throw error when not connected', async () => {
      // Mock connection failure
      mockHealth.mockRejectedValue(new Error('Connection refused'))

      // The ensureConnected method will try to connect and fail
      await expect(client.health()).rejects.toThrow('Cannot connect to daemon')
    })
  })

  describe('reconnect', () => {
    test('should disconnect and reconnect with new URL', async () => {
      mockHealth.mockResolvedValueOnce({ status: 'ok', version: '1.0.0' })
      await client.connect()

      mockHealth.mockClear()
      mockHealth.mockResolvedValueOnce({ status: 'degraded', version: '1.0.0' })

      await client.reconnect()

      // Should have made a new health check
      expect(mockHealth).toHaveBeenCalledTimes(1)
    })
  })
})
