import { useState } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void, boolean] {
	const [storedValue, setStoredValue] = useState<T>(() => {
		if (typeof window === 'undefined') {
			return initialValue
		}

		try {
			const item = window.localStorage.getItem(key)
			if (item !== null) {
				return JSON.parse(item) as T
			}
		} catch (error) {
			console.error(`Error reading localStorage key "${key}":`, error)
		}

		return initialValue
	})

	const setValue = (value: T) => {
		try {
			setStoredValue(value)
			if (typeof window !== 'undefined') {
				window.localStorage.setItem(key, JSON.stringify(value))
			}
		} catch (error) {
			console.error(`Error setting localStorage key "${key}":`, error)
		}
	}

	return [storedValue, setValue, true]
}
