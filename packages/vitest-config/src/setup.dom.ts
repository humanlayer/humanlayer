import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

// jest-dom's vitest entry imports whichever vitest copy the linker hoisted, which can differ from this
// package's; a second copy breaks `.rejects`. Register the matchers on this package's expect instead.
expect.extend(jestDomMatchers)

// React Testing Library only auto-registers cleanup when a global `afterEach`
// exists. We run Vitest with `globals: false`, so register it explicitly here
// to prevent DOM state leaking between tests.
afterEach(() => {
	cleanup()
})
