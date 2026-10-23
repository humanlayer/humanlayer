import type { JsonlRecord, JsonValue, StructuredFallbackReason } from './json-artifact-parser'

export const MAX_STRUCTURED_SOURCE_BYTES = 2 * 1024 * 1024
export const MAX_STRUCTURED_NODES = 50_000
export const MAX_STRUCTURED_DEPTH = 128

export interface JsonTreeRow {
	id: string
	parentId: string | null
	key: string | null
	value: JsonValue | null
	rowKind: 'value' | 'record' | 'invalid' | 'blank'
	sourceLine?: number
	source?: string
	message?: string
	depth: number
	indexInParent: number
	setSize: number
	isContainer: boolean
	searchableKey: string
	searchableValue: string
	displayValue: string
}

export type JsonTreeModelResult =
	| {
			kind: 'model'
			rows: JsonTreeRow[]
			rowsById: Map<string, JsonTreeRow>
			childrenById: Map<string, string[]>
			defaultExpandedIds: Set<string>
	  }
	| { kind: 'fallback'; reason: Extract<StructuredFallbackReason, 'too-many-nodes' | 'too-deep'>; message: string }

type JsonTreeModel = Extract<JsonTreeModelResult, { kind: 'model' }>

function escapePointerPart(value: string): string {
	return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function entries(value: JsonValue): Array<[string, JsonValue]> {
	if (Array.isArray(value)) return value.map((child, index) => [String(index), child])
	if (value !== null && typeof value === 'object') return Object.entries(value)
	return []
}

function formatValue(value: JsonValue, isContainer: boolean): string {
	if (isContainer) {
		const count = Array.isArray(value) ? value.length : Object.keys(value as object).length
		return `${Array.isArray(value) ? '[' : '{'}${count} ${count === 1 ? 'item' : 'items'}${Array.isArray(value) ? ']' : '}'}`
	}
	return JSON.stringify(value)
}

function createModel(): JsonTreeModel {
	return { kind: 'model', rows: [], rowsById: new Map(), childrenById: new Map(), defaultExpandedIds: new Set() }
}

function pushRow(model: JsonTreeModel, row: JsonTreeRow): JsonTreeModelResult | null {
	if (model.rows.length >= MAX_STRUCTURED_NODES) {
		return {
			kind: 'fallback',
			reason: 'too-many-nodes',
			message: `Structured view supports at most ${MAX_STRUCTURED_NODES.toLocaleString()} values.`,
		}
	}
	model.rows.push(row)
	model.rowsById.set(row.id, row)
	if (!model.childrenById.has(row.id)) model.childrenById.set(row.id, [])
	return null
}

function appendValueTree(
	model: JsonTreeModel,
	root: {
		id: string
		parentId: string | null
		key: string | null
		value: JsonValue
		depth: number
		indexInParent: number
		setSize: number
		structuredDepth: number
		sourceLine?: number
	},
): JsonTreeModelResult | null {
	const stack = [root]
	while (stack.length > 0) {
		const item = stack.pop()!
		if (item.structuredDepth > MAX_STRUCTURED_DEPTH) {
			return {
				kind: 'fallback',
				reason: 'too-deep',
				message: `Structured view supports at most ${MAX_STRUCTURED_DEPTH} levels.`,
			}
		}
		const childEntries = entries(item.value)
		const isContainer = item.value !== null && typeof item.value === 'object'
		const row: JsonTreeRow = {
			...item,
			rowKind: 'value',
			isContainer,
			searchableKey: item.key ?? '',
			searchableValue: isContainer ? '' : formatValue(item.value, false),
			displayValue: formatValue(item.value, isContainer),
		}
		const fallback = pushRow(model, row)
		if (fallback) return fallback
		const childIds = childEntries.map(([key]) => `${row.id}/${escapePointerPart(key)}`)
		model.childrenById.set(row.id, childIds)
		for (let index = childEntries.length - 1; index >= 0; index--) {
			const [key, child] = childEntries[index]!
			stack.push({
				id: childIds[index]!,
				parentId: row.id,
				key,
				value: child,
				depth: row.depth + 1,
				indexInParent: index,
				setSize: childEntries.length,
				structuredDepth: item.structuredDepth + 1,
				sourceLine: item.sourceLine,
			})
		}
	}
	return null
}

export function buildJsonTreeModel(value: JsonValue): JsonTreeModelResult {
	const model = createModel()
	const fallback = appendValueTree(model, {
		id: '',
		parentId: null,
		key: null,
		value,
		depth: 0,
		indexInParent: 0,
		setSize: 1,
		structuredDepth: 0,
	})
	if (fallback) return fallback
	if (model.rows[0]?.isContainer) model.defaultExpandedIds.add('')
	return model
}

export function buildJsonlTreeModel(records: JsonlRecord[]): JsonTreeModelResult {
	const model = createModel()
	for (let index = 0; index < records.length; index++) {
		const record = records[index]!
		const id = `/line/${record.sourceLine}`
		if (record.kind === 'value') {
			const valueFallback = appendValueTree(model, {
				id,
				parentId: null,
				key: null,
				value: record.value,
				depth: 0,
				indexInParent: index,
				setSize: records.length,
				structuredDepth: 0,
				sourceLine: record.sourceLine,
			})
			if (valueFallback) return valueFallback
		} else {
			const fallback = pushRow(model, {
				id,
				parentId: null,
				key: null,
				value: null,
				rowKind: record.kind,
				sourceLine: record.sourceLine,
				source: record.kind === 'invalid' ? record.source : undefined,
				message: record.kind === 'invalid' ? record.message : undefined,
				depth: 0,
				indexInParent: index,
				setSize: records.length,
				isContainer: false,
				searchableKey: '',
				searchableValue: '',
				displayValue: record.kind === 'blank' ? '(blank line)' : record.source,
			})
			if (fallback) return fallback
		}
	}
	return model
}

export function getDefaultExpandedIds(model: JsonTreeModel): Set<string> {
	return new Set(model.defaultExpandedIds)
}

export function flattenVisibleRows(model: JsonTreeModel, expandedIds: ReadonlySet<string>): JsonTreeRow[] {
	return model.rows.filter((row) => {
		let parentId = row.parentId
		while (parentId !== null) {
			if (!expandedIds.has(parentId)) return false
			parentId = model.rowsById.get(parentId)?.parentId ?? null
		}
		return true
	})
}

export function getAncestorIds(model: JsonTreeModel, rowIds: Iterable<string>): Set<string> {
	const ancestors = new Set<string>()
	for (const rowId of rowIds) {
		let parentId = model.rowsById.get(rowId)?.parentId ?? null
		while (parentId !== null) {
			ancestors.add(parentId)
			parentId = model.rowsById.get(parentId)?.parentId ?? null
		}
	}
	return ancestors
}
