import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Checks if the application is running in Tauri (desktop) environment.
 * Returns false if running in a browser or test environment.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}
