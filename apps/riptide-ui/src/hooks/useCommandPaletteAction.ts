import { useEffect, useRef } from 'react'

import { type CommandPaletteAction, useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'

type ActionRegistration = {
	token: symbol
	action: CommandPaletteAction
}

const registrationsById = new Map<string, ActionRegistration[]>()

function syncActiveRegistration(id: string) {
	const registrations = registrationsById.get(id)
	const active = registrations?.[registrations.length - 1]
	const store = useCommandPaletteStore.getState()

	if (active) store.registerAction(active.action)
	else store.unregisterAction(id)
}

function registerOrUpdate(token: symbol, action: CommandPaletteAction) {
	const registrations = registrationsById.get(action.id) ?? []
	const existingIndex = registrations.findIndex((registration) => registration.token === token)
	const registration = { token, action }

	if (existingIndex >= 0) registrations[existingIndex] = registration
	else registrations.push(registration)

	registrationsById.set(action.id, registrations)
	syncActiveRegistration(action.id)
}

function unregister(token: symbol, id: string) {
	const registrations = registrationsById.get(id)
	if (!registrations) return

	const remaining = registrations.filter((registration) => registration.token !== token)
	if (remaining.length > 0) registrationsById.set(id, remaining)
	else registrationsById.delete(id)
	syncActiveRegistration(id)
}

export function useCommandPaletteAction(action: CommandPaletteAction) {
	const tokenRef = useRef(Symbol(action.id))
	const actionRef = useRef(action)
	actionRef.current = action

	useEffect(() => {
		if (action.enabled === false) return
		const token = tokenRef.current
		registerOrUpdate(token, actionRef.current)
		return () => unregister(token, action.id)
	}, [action.id, action.enabled])

	useEffect(() => {
		if (action.enabled === false) return
		registerOrUpdate(tokenRef.current, actionRef.current)
	}, [action.id, action.label, action.icon, action.shortcut, action.enabled, action.onSelect])
}

export type { CommandPaletteAction }
