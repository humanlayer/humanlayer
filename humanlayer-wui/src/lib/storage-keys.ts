/**
 * Centralized localStorage and sessionStorage keys
 * 
 * This file consolidates all storage keys used throughout the application
 * to prevent typos and make key management easier.
 */

// ===============================
// Theme and UI Preferences
// ===============================

/** Theme preference storage key */
export const THEME_STORAGE_KEY = 'wui-theme'

// ===============================
// Session Management
// ===============================

/** Session response input storage - base key */
export const RESPONSE_INPUT_STORAGE_KEY = 'response-input'

/** 
 * Get the full storage key for session response input
 * @param sessionId - The session ID
 * @returns Full storage key for the session's response input
 */
export const getSessionResponseInputKey = (sessionId: string): string => 
  `${RESPONSE_INPUT_STORAGE_KEY}.${sessionId}`

// ===============================  
// Session Launcher
// ===============================

/** Last working directory used in session launcher */
export const LAST_WORKING_DIR_KEY = 'humanlayer-last-working-dir'

/** Session launcher query persistence */
export const SESSION_LAUNCHER_QUERY_KEY = 'session-launcher-query'

// ===============================
// Session-Specific Features
// ===============================

/**
 * Get the storage key for session-specific brainrot mode
 * @param sessionId - The session ID
 * @returns Storage key for the session's brainrot mode setting
 */
export const getBrainrotModeKey = (sessionId: string): string => 
  `brainrot-mode-${sessionId}`

// ===============================
// Demo and Development
// ===============================

/** Demo mode preferences (if applicable) */
export const DEMO_PREFERENCES_KEY = 'wui-demo-preferences'

// ===============================
// Utility Functions
// ===============================

/**
 * Safely get item from localStorage with fallback
 * @param key - Storage key
 * @param fallback - Fallback value if key doesn't exist
 * @returns Stored value or fallback
 */
export const getStorageItem = (key: string, fallback: string = ''): string => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Safely set item in localStorage
 * @param key - Storage key
 * @param value - Value to store
 */
export const setStorageItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Safely remove item from localStorage
 * @param key - Storage key to remove
 */
export const removeStorageItem = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    // Silently fail if localStorage is not available
  }
}