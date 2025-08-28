import { invoke } from '@tauri-apps/api/core'

// Function to get the actual computed CSS variable value
function getCSSVariableValue(variableName: string): string {
  const computedStyle = getComputedStyle(document.documentElement)
  return computedStyle.getPropertyValue(variableName).trim()
}

// Function to convert CSS color to hex if needed
function colorToHex(color: string): string {
  // If already hex, return as-is
  if (color.startsWith('#')) {
    return color
  }

  // Create a temporary element to compute the color
  const temp = document.createElement('div')
  temp.style.color = color
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)

  // Parse rgb/rgba
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }

  return color
}

export async function syncWindowBackgroundWithTheme(windowLabel: string) {
  try {
    // Get the actual computed values of both background and foreground
    const bgColor = getCSSVariableValue('--terminal-bg')
    const fgColor = getCSSVariableValue('--terminal-fg')
    const bgHex = colorToHex(bgColor)
    const fgHex = colorToHex(fgColor)

    await invoke('set_window_theme_colors', {
      windowLabel,
      bgHex,
      fgHex,
    })
  } catch (error) {
    console.warn('Failed to sync window theme colors:', error)
    // This is expected to fail on non-macOS platforms
  }
}
