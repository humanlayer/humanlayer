import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { createErrorInterceptor } from './middleware'
import { ErrorContext } from './generated/runtime'

describe('createErrorInterceptor', () => {
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleError = console.error
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('should log errors when logErrors is true', async () => {
    const mockConsoleError = mock(() => {})
    console.error = mockConsoleError as any

    const middleware = createErrorInterceptor({ logErrors: true })

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/sessions',
      init: { method: 'GET' },
      error: new Error('Connection refused'),
    }

    await middleware.onError!(context)

    expect(mockConsoleError).toHaveBeenCalledWith(
      '[HLD SDK] Fetch error:',
      {
        url: context.url,
        method: 'GET',
        error: 'Connection refused',
      }
    )
  })

  it('should not log errors when logErrors is false', async () => {
    const mockConsoleError = mock(() => {})
    console.error = mockConsoleError as any

    const middleware = createErrorInterceptor({ logErrors: false })

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/sessions',
      init: { method: 'GET' },
      error: new Error('Connection refused'),
    }

    await middleware.onError!(context)

    expect(mockConsoleError).not.toHaveBeenCalled()
  })

  it('should call custom onError handler', async () => {
    const mockOnError = mock(() => {})
    const middleware = createErrorInterceptor({ onError: mockOnError })

    const error = new Error('Test error')
    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/health',
      init: { method: 'GET' },
      error,
    }

    await middleware.onError!(context)

    expect(mockOnError).toHaveBeenCalledWith(error, context)
  })

  it('should handle non-Error objects', async () => {
    const mockOnError = mock(() => {})
    const middleware = createErrorInterceptor({ onError: mockOnError })

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/health',
      init: { method: 'POST' },
      error: 'String error',
    }

    await middleware.onError!(context)

    expect(mockOnError).toHaveBeenCalledTimes(1)
    const [errorArg] = mockOnError.mock.calls[0]
    expect(errorArg).toBeInstanceOf(Error)
    expect(errorArg.message).toBe('String error')
  })

  it('should not return alternative response', async () => {
    const middleware = createErrorInterceptor()

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/sessions',
      init: { method: 'GET' },
      error: new Error('Network failure'),
    }

    const result = await middleware.onError!(context)

    expect(result).toBeUndefined()
  })

  it('should log errors by default when no options provided', async () => {
    const mockConsoleError = mock(() => {})
    console.error = mockConsoleError as any

    const middleware = createErrorInterceptor()

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/sessions',
      init: { method: 'DELETE' },
      error: new Error('Server error'),
    }

    await middleware.onError!(context)

    expect(mockConsoleError).toHaveBeenCalledWith(
      '[HLD SDK] Fetch error:',
      {
        url: context.url,
        method: 'DELETE',
        error: 'Server error',
      }
    )
  })

  it('should handle missing method in request init', async () => {
    const mockConsoleError = mock(() => {})
    console.error = mockConsoleError as any

    const middleware = createErrorInterceptor({ logErrors: true })

    const context: ErrorContext = {
      fetch: global.fetch,
      url: 'http://localhost:7777/api/v1/sessions',
      init: {}, // No method specified
      error: new Error('Connection refused'),
    }

    await middleware.onError!(context)

    expect(mockConsoleError).toHaveBeenCalledWith(
      '[HLD SDK] Fetch error:',
      {
        url: context.url,
        method: undefined,
        error: 'Connection refused',
      }
    )
  })
})