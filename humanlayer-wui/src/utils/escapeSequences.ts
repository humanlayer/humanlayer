/**
 * Processes escape sequences in strings for display purposes.
 * Converts escape sequence strings like \t, \n, \r to their actual characters.
 *
 * @param str - The string potentially containing escape sequences
 * @returns The processed string with escape sequences converted to actual characters
 */
export function processEscapeSequences(str: string): string {
  if (!str) return str

  // Replace common escape sequences with their actual characters
  return str
    .replace(/\\t/g, '    ') // Convert \t to 4 spaces (as per requirement)
    .replace(/\\n/g, '\n') // Convert \n to actual newline
    .replace(/\\r/g, '\r') // Convert \r to actual carriage return
    .replace(/\\\\/g, '\\') // Convert \\ to single backslash
    .replace(/\\"/g, '"') // Convert \" to quote
    .replace(/\\'/g, "'") // Convert \' to single quote
}

/**
 * Checks if a string contains escape sequences that need processing.
 * Used to optimize performance by avoiding unnecessary processing.
 *
 * @param str - The string to check
 * @returns True if the string contains escape sequences
 */
export function hasEscapeSequences(str: string): boolean {
  if (!str) return false
  return /\\[tnr\\"']/.test(str)
}
