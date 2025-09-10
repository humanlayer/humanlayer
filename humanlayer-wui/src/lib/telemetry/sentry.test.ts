import { describe, test, expect, beforeEach, mock } from 'bun:test'
import type * as SentryType from '@sentry/react'
import { useStore } from '@/AppStore'
import { scrubSensitiveData, captureException, captureMessage } from './sentry'

// Mock Sentry module
const mockSentryCaptureException = mock()
const mockSentryCaptureMessage = mock()

mock.module('@sentry/react', () => ({
  default: {
    captureException: mockSentryCaptureException,
    captureMessage: mockSentryCaptureMessage,
    init: mock(),
    browserTracingIntegration: mock(),
    breadcrumbsIntegration: mock(),
    withErrorBoundary: mock(Component => Component),
  },
  captureException: mockSentryCaptureException,
  captureMessage: mockSentryCaptureMessage,
  init: mock(),
  browserTracingIntegration: mock(),
  breadcrumbsIntegration: mock(),
  withErrorBoundary: mock(Component => Component),
}))

describe('Sentry Data Sanitization', () => {
  beforeEach(() => {
    // Reset mocks
    mockSentryCaptureException.mockClear()
    mockSentryCaptureMessage.mockClear()

    // Set default state in the real store
    // Only set the userSettings part we care about
    const currentState = useStore.getState()
    useStore.setState({
      ...currentState,
      userSettings: {
        advancedProviders: false,
        optInTelemetry: true,
      },
    })
  })

  describe('scrubSensitiveData', () => {
    test('removes Zustand store data completely', () => {
      const event = {
        contexts: {
          state: { someStoreData: 'sensitive' },
        },
        extra: {
          store: { messages: ['user prompt'] },
          conversation: { content: 'agent response' },
        },
      } as unknown as SentryType.Event

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.contexts?.state).toBeUndefined()
      expect(scrubbed.extra?.store).toBeUndefined()
      expect(scrubbed.extra?.conversation).toBeUndefined()
    })

    test('never sends user prompts or file contents', () => {
      const event: SentryType.Event = {
        extra: {
          prompt: 'Write me a function',
          file_content: 'const secret = "key"',
          messages: [{ role: 'user', content: 'help' }],
          working_directory: '/Users/nyx/secret-project',
        },
        breadcrumbs: [
          {
            data: {
              prompt: 'user input',
              query: 'search term',
              file_content: 'code',
            },
          },
        ],
      }

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.extra?.prompt).toBeUndefined()
      expect(scrubbed.extra?.file_content).toBeUndefined()
      expect(scrubbed.extra?.messages).toBeUndefined()
      expect(scrubbed.extra?.working_directory).toBeUndefined()
      expect(scrubbed.breadcrumbs?.[0]?.data?.prompt).toBeUndefined()
      expect(scrubbed.breadcrumbs?.[0]?.data?.query).toBeUndefined()
      expect(scrubbed.breadcrumbs?.[0]?.data?.file_content).toBeUndefined()
    })

    test('removes sensitive headers and scrubs URLs', () => {
      const event: SentryType.Event = {
        request: {
          url: 'https://api.example.com/endpoint?api_key=secret&token=abc123&query=search',
          headers: {
            Authorization: 'Bearer secret',
            'X-API-Key': 'secret-key',
            Cookie: 'session=secret',
            'Content-Type': 'application/json',
          },
        },
      }

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.request?.url).toBe(
        'https://api.example.com/endpoint?api_key=REDACTED&token=REDACTED&query=REDACTED',
      )
      expect(scrubbed.request?.headers?.['Authorization']).toBeUndefined()
      expect(scrubbed.request?.headers?.['X-API-Key']).toBeUndefined()
      expect(scrubbed.request?.headers?.['Cookie']).toBeUndefined()
      expect(scrubbed.request?.headers?.['Content-Type']).toBe('application/json')
    })

    test('anonymizes user data', () => {
      const event: SentryType.Event = {
        user: {
          id: 'user123',
          email: 'user@example.com',
          username: 'testuser',
        },
      }

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.user?.id).toBeDefined()
      expect(scrubbed.user?.id).not.toBe('user123')
      expect(scrubbed.user?.email).toBeUndefined()
      expect(scrubbed.user?.username).toBeUndefined()
    })

    test('filters out sensitive breadcrumbs', () => {
      const event: SentryType.Event = {
        breadcrumbs: [
          { category: 'navigation', data: { to: '/settings' } },
          { message: 'Store updated', category: 'zustand' },
          { message: 'Something with store in it' },
        ],
      }

      const scrubbed = scrubSensitiveData(event)
      // Should only keep the navigation breadcrumb
      expect(scrubbed.breadcrumbs?.length).toBe(1)
      expect(scrubbed.breadcrumbs?.[0]?.category).toBe('navigation')
    })

    test('scrubs extra context data aggressively', () => {
      const event: SentryType.Event = {
        extra: {
          normal_data: 'this is fine',
          store_data: 'sensitive',
          session_info: 'should be removed',
          conversation_content: 'should be removed',
          approval_details: 'should be removed',
          messages_array: ['should', 'be', 'removed'],
          api_key: 'secret',
          nested: {
            state: 'sensitive nested data',
          },
        },
      }

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.extra?.normal_data).toBe('this is fine')
      expect(scrubbed.extra?.store_data).toBeUndefined()
      expect(scrubbed.extra?.session_info).toBeUndefined()
      expect(scrubbed.extra?.conversation_content).toBeUndefined()
      expect(scrubbed.extra?.approval_details).toBeUndefined()
      expect(scrubbed.extra?.messages_array).toBeUndefined()
      expect(scrubbed.extra?.api_key).toBeUndefined()
      expect(scrubbed.extra?.nested).toBeUndefined()
    })

    test('removes session-related data from breadcrumbs', () => {
      const event: SentryType.Event = {
        breadcrumbs: [
          {
            data: {
              session: { id: 'session123' },
              conversation: 'chat history',
              approval: { id: 'approval456' },
            },
          },
        ],
      }

      const scrubbed = scrubSensitiveData(event)
      expect(scrubbed.breadcrumbs?.[0]?.data?.session).toBeUndefined()
      expect(scrubbed.breadcrumbs?.[0]?.data?.conversation).toBeUndefined()
      expect(scrubbed.breadcrumbs?.[0]?.data?.approval).toBeUndefined()
    })
  })

  describe('captureException', () => {
    test('respects user consent when disabled', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: {
          advancedProviders: false,
          optInTelemetry: false,
        },
      })

      const error = new Error('Test error')
      captureException(error)

      // Should not call Sentry when opted out
      expect(mockSentryCaptureException).not.toHaveBeenCalled()
    })

    test('captures exception when opted in', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: {
          advancedProviders: false,
          optInTelemetry: true,
        },
      })

      const error = new Error('Test error')
      const context = { testType: 'unit_test' }
      captureException(error, context)

      // Should call Sentry when opted in
      expect(mockSentryCaptureException).toHaveBeenCalledWith(error, expect.any(Object))
    })

    test('does not capture when userSettings is null', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: null,
      })

      const error = new Error('Test error')
      captureException(error)

      // Should not call Sentry when settings not loaded
      expect(mockSentryCaptureException).not.toHaveBeenCalled()
    })
  })

  describe('captureMessage', () => {
    test('respects user consent when disabled', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: {
          advancedProviders: false,
          optInTelemetry: false,
        },
      })

      captureMessage('Test message')

      // Should not call Sentry when opted out
      expect(mockSentryCaptureMessage).not.toHaveBeenCalled()
    })

    test('captures message when opted in', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: {
          advancedProviders: false,
          optInTelemetry: true,
        },
      })

      captureMessage('Test message', 'info', { extra: 'data' })

      // Should call Sentry when opted in
      expect(mockSentryCaptureMessage).toHaveBeenCalledWith('Test message', expect.any(Object))
    })

    test('scrubs context data before sending', () => {
      const currentState = useStore.getState()
      useStore.setState({
        ...currentState,
        userSettings: {
          advancedProviders: false,
          optInTelemetry: true,
        },
      })

      const sensitiveContext = {
        api_key: 'secret',
        normal: 'data',
        session: 'should be removed',
      }

      captureMessage('Test message', 'info', sensitiveContext)

      // Should call Sentry but context should be scrubbed
      expect(mockSentryCaptureMessage).toHaveBeenCalled()
      const callArgs = mockSentryCaptureMessage.mock.calls[0]
      expect(callArgs[1].extra).toBeDefined()
      // The scrubbing should remove sensitive fields
      expect(callArgs[1].extra.api_key).toBeUndefined()
      expect(callArgs[1].extra.session).toBeUndefined()
      expect(callArgs[1].extra.normal).toBe('data')
    })
  })
})
