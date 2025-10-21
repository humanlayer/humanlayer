import { afterEach, expect, mock } from 'bun:test'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Mock posthog-js/react module
mock.module('posthog-js/react', () => ({
  usePostHog: () => ({
    capture: () => {},
    identify: () => {},
    reset: () => {},
    captureException: () => {},
  }),
  PostHogProvider: ({ children }: { children: any }) => children,
}))

// Mock Tauri window internals to prevent errors in tests
if (typeof window !== 'undefined') {
  ;(window as any).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(),
    transformCallback: () => {},
    convertFileSrc: (src: string) => src,
  }
}

expect.extend(matchers)

afterEach(() => {
  cleanup()
})
