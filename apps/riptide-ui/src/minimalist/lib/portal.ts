import { createContext, useContext } from 'react'

export const MinimalistPortalContext = createContext<HTMLElement | null>(null)

export function useMinimalistPortal() {
	return useContext(MinimalistPortalContext)
}
