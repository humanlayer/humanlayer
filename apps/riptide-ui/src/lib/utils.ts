import { type ClassValue, clsx } from 'clsx'
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

export function isElectron(): boolean {
	return typeof window !== 'undefined' && '__RIPTIDE_ELECTRON__' in window
}

export function isDesktop(): boolean {
	return isTauri() || isElectron()
}
