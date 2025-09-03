import { afterEach, expect } from 'bun:test'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

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
