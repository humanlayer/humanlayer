/**
 * Checks if the user has selected text in the browser
 * @returns true if text is selected, false otherwise
 */
export function hasTextSelection(): boolean {
  const selection = window.getSelection()
  if (!selection) return false

  const selectedText = selection.toString().trim()
  return selectedText.length > 0
}

/**
 * Clears the current text selection
 */
export function clearTextSelection(): void {
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
  }
}
