import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Simple smoke test to verify file structure and exports
describe('CommandPaletteMenu', () => {
  it('has a CommandPaletteMenu.tsx file', () => {
    const filePath = resolve(__dirname, 'CommandPaletteMenu.tsx')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('export default function CommandPaletteMenu')
  })

  it('has an index.tsx file that exports the component', () => {
    const filePath = resolve(__dirname, 'index.tsx')
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain("export { default } from './CommandPaletteMenu'")
  })

  it('contains the expected component structure', () => {
    const filePath = resolve(__dirname, 'CommandPaletteMenu.tsx')
    const content = readFileSync(filePath, 'utf-8')

    // Verify imports are correctly updated
    expect(content).toContain("from '../internal/EmptyState'")
    expect(content).toContain("from '../HotkeyPanel'")

    // Verify the component exports
    expect(content).toContain('export default function CommandPaletteMenu')
  })
})
