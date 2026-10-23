import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// jest-dom's vitest types augment the vitest 4 `Assertion<T>` shape; vitest 5 reads custom matchers from `Matchers<R, T>`.
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<any, R> {}
}
