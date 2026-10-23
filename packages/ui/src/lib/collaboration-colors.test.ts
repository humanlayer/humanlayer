import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { collaborationColor, collaborationPaletteSlot } from './collaboration-colors'

test('member palette is deterministic, bounded to ANSI colors, and not CSS-controlled by peer input', () => {
  for (const id of ['one', 'two', 'three', '"; background:url(evil)', '<script>', '']) {
    expect(collaborationPaletteSlot(id)).toBe(collaborationPaletteSlot(id))
    expect(collaborationColor(id)).toMatch(/^var\(--terminal-color-[1-6]\)$/)
  }
})

test('actual shared stylesheet forces square carets, selections and roster descendants under rounded preferences', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/globals.css`, 'utf8')
  const rule = css.match(/\.response-caret,\s*\.response-caret-label,\s*\.response-selection,\s*\.response-presence,\s*\.response-presence \*\s*\{([^}]+)\}/)?.[1]
  expect(rule).toContain('border-radius: 0 !important')
  const style = document.createElement('style')
  style.textContent = `.rounded-preference * { border-radius: 20px; } .response-caret, .response-caret-label, .response-selection, .response-presence, .response-presence * { ${rule} }`
  const root = document.createElement('div')
  root.className = 'rounded-preference'
  root.innerHTML = '<span class="response-caret"><span class="response-caret-label">Name</span></span><span class="response-selection">Text</span><span class="response-presence"><img><span class="response-presence-marker"></span></span>'
  document.head.append(style)
  document.body.append(root)
  try {
    for (const node of root.querySelectorAll('*')) expect(getComputedStyle(node).borderRadius).toBe('0px')
  } finally { style.remove(); root.remove() }
})

test('selection and name backgrounds use stronger theme-derived colors with readable theme foreground', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/globals.css`, 'utf8')
  expect(css).toContain('var(--collaboration-color) 40%, transparent')
  expect(css).toContain('var(--collaboration-color) 45%, var(--terminal-bg)')
  const label = css.match(/\.response-caret-label\s*\{([^}]+)\}/)?.[1]
  expect(label).toContain('color: var(--terminal-fg)')
  expect(label).toContain('pointer-events: none')
})
