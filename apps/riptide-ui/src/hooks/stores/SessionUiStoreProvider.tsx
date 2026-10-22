import { type ReactNode, useState } from 'react'

import { createSessionUiStore, SessionUiStoreContext } from './sessionUiStore'

/** Mount inside the session key: the instance, not its changing snapshot, is the context value. */
export function SessionUiStoreProvider({ children }: { children: ReactNode }) {
	const [store] = useState(createSessionUiStore)
	return <SessionUiStoreContext.Provider value={store}>{children}</SessionUiStoreContext.Provider>
}
