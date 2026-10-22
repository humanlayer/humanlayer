import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useDraftField } from './use-draft-field'

describe('useDraftField', () => {
	beforeEach(() => {
		window.sessionStorage.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		window.sessionStorage.clear()
	})

	test('reads the saved draft at mount', () => {
		window.sessionStorage.setItem('draft:key', JSON.stringify('hello'))
		const { result } = renderHook(() => useDraftField('draft:key'))
		expect(result.current.value).toBe('hello')
	})

	test('value is empty when no draft is stored', () => {
		const { result } = renderHook(() => useDraftField('draft:key'))
		expect(result.current.value).toBe('')
	})

	test('does not seed an empty placeholder key on mount', () => {
		renderHook(() => useDraftField('draft:key'))
		expect(window.sessionStorage.getItem('draft:key')).toBeNull()
	})

	test('setValue writes through to sessionStorage and updates value reactively', () => {
		const { result } = renderHook(() => useDraftField('draft:key'))
		act(() => result.current.setValue('typed text'))
		expect(window.sessionStorage.getItem('draft:key')).toBe(JSON.stringify('typed text'))
		expect(result.current.value).toBe('typed text')
	})

	test("setValue('') removes the key", () => {
		window.sessionStorage.setItem('draft:key', JSON.stringify('existing'))
		const { result } = renderHook(() => useDraftField('draft:key'))
		act(() => result.current.setValue(''))
		expect(window.sessionStorage.getItem('draft:key')).toBeNull()
		expect(result.current.value).toBe('')
	})

	test('setValue with whitespace-only value removes the key', () => {
		window.sessionStorage.setItem('draft:key', JSON.stringify('existing'))
		const { result } = renderHook(() => useDraftField('draft:key'))
		act(() => result.current.setValue('   \n  '))
		expect(window.sessionStorage.getItem('draft:key')).toBeNull()
	})

	test('clear removes the key', () => {
		window.sessionStorage.setItem('draft:key', JSON.stringify('existing'))
		const { result } = renderHook(() => useDraftField('draft:key'))
		act(() => result.current.clear())
		expect(window.sessionStorage.getItem('draft:key')).toBeNull()
	})

	test('tracks the value of the current key when the key changes', () => {
		window.sessionStorage.setItem('draft:a', JSON.stringify('value a'))
		window.sessionStorage.setItem('draft:b', JSON.stringify('value b'))
		const { result, rerender } = renderHook(({ key }) => useDraftField(key), {
			initialProps: { key: 'draft:a' },
		})
		expect(result.current.value).toBe('value a')
		rerender({ key: 'draft:b' })
		expect(result.current.value).toBe('value b')
	})
})
