import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

type UiState = {
	sidebarOpen: boolean
	taskSidebarOpen: boolean
	toggleTaskSidebar: () => void
	closeTaskSidebarOnNarrow: () => void
	toggleSidebar: () => void
	closeSidebarOnNarrow: () => void
	panelOpen: boolean
	togglePanel: () => void
	attentionView: boolean
	toggleAttentionView: () => void
	showAttentionView: () => void
	searchOpen: boolean
	setSearchOpen: (open: boolean) => void
	theme: ThemePreference
	setTheme: (theme: ThemePreference) => void
	/** The toast on screen; `id` tells a repeat of the same text from the one before. */
	toast: { id: number; text: string; action?: { label: string; run: () => void } } | null
	showToast: (text: string, action?: { label: string; run: () => void }) => void
	dismissToast: (id: number) => void
}

let toastCount = 0

const UiContext = createContext<UiState | null>(null)

function readStored<T extends string>(key: string, fallback: T): T {
	try {
		return (localStorage.getItem(key) as T | null) ?? fallback
	} catch {
		return fallback
	}
}

function store(key: string, value: string) {
	try {
		localStorage.setItem(key, value)
	} catch {
		// The current view still works when the browser blocks storage.
	}
}

export function UiProvider({ children }: { children: ReactNode }) {
	const [sidebarOpen, setSidebarOpen] = useState(
		() => !matchMedia('(max-width: 900px)').matches && readStored('hl-min-sidebar', 'open') === 'open',
	)
	const [taskSidebarOpen, setTaskSidebarOpen] = useState(() => !matchMedia('(max-width: 1050px)').matches)
	const toggleTaskSidebar = useCallback(() => setTaskSidebarOpen((open) => !open), [])
	const closeTaskSidebarOnNarrow = useCallback(() => {
		if (matchMedia('(max-width: 1050px)').matches) {
			setTaskSidebarOpen(false)
			requestAnimationFrame(() =>
				document.querySelector<HTMLElement>('.task-primary:not([hidden]), .task-content > .main')?.focus(),
			)
		}
	}, [])
	const [attentionView, setAttentionView] = useState(false)
	const [panelOpen, setPanelOpen] = useState(
		() =>
			!matchMedia('(max-width: 1200px)').matches &&
			readStored<'open' | 'closed'>('hl-min-panel', 'closed') === 'open',
	)
	const [searchOpen, setSearchOpen] = useState(false)
	const [theme, setThemeState] = useState<ThemePreference>(() => readStored('hl-min-theme', 'system'))
	const [toast, setToast] = useState<UiState['toast']>(null)

	const toggleSidebar = useCallback(() => {
		store('hl-min-sidebar', sidebarOpen ? 'closed' : 'open')
		setSidebarOpen(!sidebarOpen)
	}, [sidebarOpen])
	const closeSidebarOnNarrow = useCallback(() => {
		if (matchMedia('(max-width: 900px)').matches) setSidebarOpen(false)
	}, [])
	const togglePanel = useCallback(() => {
		store('hl-min-panel', panelOpen ? 'closed' : 'open')
		setPanelOpen(!panelOpen)
	}, [panelOpen])
	const setTheme = useCallback((next: ThemePreference) => {
		store('hl-min-theme', next)
		setThemeState(next)
	}, [])
	const showToast = useCallback<UiState['showToast']>((text, action) => {
		toastCount += 1
		setToast({ id: toastCount, text, action })
	}, [])
	const dismissToast = useCallback((id: number) => {
		setToast((current) => (current?.id === id ? null : current))
	}, [])

	const value = useMemo(
		() => ({
			sidebarOpen,
			taskSidebarOpen,
			toggleTaskSidebar,
			closeTaskSidebarOnNarrow,
			toggleSidebar,
			closeSidebarOnNarrow,
			panelOpen,
			togglePanel,
			attentionView,
			toggleAttentionView: () => setAttentionView((open) => !open),
			showAttentionView: () => {
				setAttentionView(true)
				setSidebarOpen(true)
			},
			searchOpen,
			setSearchOpen,
			theme,
			setTheme,
			toast,
			showToast,
			dismissToast,
		}),
		[
			sidebarOpen,
			taskSidebarOpen,
			toggleTaskSidebar,
			closeTaskSidebarOnNarrow,
			toggleSidebar,
			closeSidebarOnNarrow,
			panelOpen,
			togglePanel,
			attentionView,
			searchOpen,
			theme,
			setTheme,
			toast,
			showToast,
			dismissToast,
		],
	)
	return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function useUi(): UiState {
	const value = useContext(UiContext)
	if (!value) throw new Error('useUi must be used inside UiProvider')
	return value
}
