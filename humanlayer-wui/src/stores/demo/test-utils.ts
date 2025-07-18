import { StoreApi } from 'zustand'
import { expect } from 'bun:test'

/**
 * Enhanced store test wrapper with common utilities
 */
export function createStoreTest<T>(createStore: () => StoreApi<T>) {
  const store = createStore()

  return {
    store,
    getState: () => store.getState(),
    // Execute action and return new state
    act: (action: (state: T) => void) => {
      action(store.getState())
      return store.getState()
    },
    // Test a setter function
    testSetter: <K extends keyof T>(setterName: keyof T, property: K, value: T[K]) => {
      const setter = store.getState()[setterName] as any
      setter(value)
      expect(store.getState()[property]).toBe(value)
    },
    // Test multiple setters at once
    testSetters: (tests: Array<[keyof T, keyof T, any]>) => {
      tests.forEach(([setter, property, value]) => {
        const setterFn = store.getState()[setter] as any
        setterFn(value)
        expect(store.getState()[property]).toBe(value)
      })
    },
  }
}

/**
 * Test initial state with multiple expectations
 */
export function testInitialState<T>(state: T, expectations: Partial<T>) {
  Object.entries(expectations).forEach(([key, value]) => {
    const stateValue = state[key as keyof T]
    if (Array.isArray(value) && Array.isArray(stateValue)) {
      expect(stateValue.length).toBe(value.length)
      expect(JSON.stringify(stateValue)).toBe(JSON.stringify(value))
    } else {
      expect(stateValue).toBe(value as T[keyof T])
    }
  })
}

/**
 * Assert multiple functions exist
 */
export function assertFunctions<T>(state: T, functionNames: (keyof T)[]) {
  functionNames.forEach(name => {
    expect(typeof state[name]).toBe('function')
  })
}

/**
 * Test navigation with wrapping
 */
export interface NavigationTestCase {
  current: number
  action: 'next' | 'prev' | 'up' | 'down'
  expected: number
  total: number
  description?: string
}

export function createNavigationTests(
  cases: NavigationTestCase[],
): Array<[string, NavigationTestCase]> {
  return cases.map(testCase => [
    testCase.description ||
      `navigate ${testCase.action} from ${testCase.current} to ${testCase.expected}`,
    testCase,
  ])
}

/**
 * Mock data factories
 */
export const mockFactory = {
  approvals: (count = 3) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${i + 1}`,
      title: `Approval ${i + 1}`,
      status: 'pending',
    })),

  sessions: (count = 3) =>
    Array.from({ length: count }, (_, i) => ({
      id: `session-${i + 1}`,
      // Add other session properties as needed
    })),
}

/**
 * Test multiple state changes in sequence
 */
export function testSequence<T>(
  store: StoreApi<T>,
  steps: Array<{
    action: (state: T) => void
    verify: (state: T) => void
    description?: string
  }>,
) {
  steps.forEach((step, index) => {
    try {
      step.action(store.getState())
      const newState = store.getState()
      step.verify(newState)
    } catch (error) {
      throw new Error(
        `Step ${index + 1} failed${step.description ? ` (${step.description})` : ''}: ${error}`,
      )
    }
  })
}

/**
 * Async test helpers
 */
export async function waitMs(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function testAnimationSteps(
  steps: Array<{
    wait: number
    test: () => void
    description?: string
  }>,
) {
  for (const [index, step] of steps.entries()) {
    await waitMs(step.wait)
    try {
      step.test()
    } catch (error) {
      throw new Error(
        `Animation step ${index + 1} failed${
          step.description ? ` (${step.description})` : ''
        }: ${error}`,
      )
    }
  }
}
