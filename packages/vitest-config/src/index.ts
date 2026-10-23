// NOTE: relative imports in this package use explicit .ts extensions. Vite's
// config loader externalizes this workspace package, so Node imports the
// TypeScript source natively (type stripping) and applies strict ESM
// resolution — extensionless relative imports would fail at load time.
export { base } from './base.ts'
export { dom } from './dom.ts'
export { projects } from './projects.ts'
