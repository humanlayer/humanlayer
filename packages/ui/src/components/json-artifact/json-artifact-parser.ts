import { MAX_STRUCTURED_NODES, MAX_STRUCTURED_SOURCE_BYTES } from './json-tree-model'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type StructuredFallbackReason = 'empty' | 'invalid' | 'source-too-large' | 'too-many-nodes' | 'too-deep'

export type JsonlRecord =
	| { kind: 'value'; sourceLine: number; value: JsonValue }
	| { kind: 'invalid'; sourceLine: number; source: string; message: string }
	| { kind: 'blank'; sourceLine: number }

export type JsonParseResult =
	| { kind: 'value'; value: JsonValue; source: string; sourceBytes: number }
	| { kind: 'fallback'; reason: StructuredFallbackReason; source: string; message: string; sourceBytes: number }

export type JsonlParseResult =
	| { kind: 'records'; records: JsonlRecord[]; source: string; sourceBytes: number }
	| {
			kind: 'fallback'
			reason: Extract<StructuredFallbackReason, 'empty' | 'source-too-large' | 'too-many-nodes'>
			source: string
			message: string
			sourceBytes: number
	  }

function getSourceBytes(source: string): number {
	return new TextEncoder().encode(source).byteLength
}

function sourceSizeFallback(source: string, sourceBytes: number): {
	kind: 'fallback'
	reason: 'source-too-large'
	source: string
	message: string
	sourceBytes: number
} {
	return {
		kind: 'fallback',
		reason: 'source-too-large',
		source,
		sourceBytes,
		message: 'Structured view is unavailable because this file is larger than 2 MiB.',
	}
}

function jsonlNodeLimitFallback(source: string, sourceBytes: number): Extract<JsonlParseResult, { kind: 'fallback' }> {
	return {
		kind: 'fallback',
		reason: 'too-many-nodes',
		source,
		sourceBytes,
		message: `Structured view supports at most ${MAX_STRUCTURED_NODES.toLocaleString()} JSONL nodes.`,
	}
}

function countJsonNodes(value: JsonValue, limit: number): number {
	const stack = [value]
	let count = 0
	while (stack.length > 0) {
		const current = stack.pop()!
		count++
		if (count > limit) return count
		if (Array.isArray(current)) {
			for (const child of current) stack.push(child)
		} else if (current !== null && typeof current === 'object') {
			for (const child of Object.values(current)) stack.push(child)
		}
	}
	return count
}

export function parseJsonArtifact(source: string): JsonParseResult {
	const sourceBytes = getSourceBytes(source)
	if (sourceBytes > MAX_STRUCTURED_SOURCE_BYTES) {
		return sourceSizeFallback(source, sourceBytes)
	}
	if (source.trim() === '') {
		return { kind: 'fallback', reason: 'empty', source, sourceBytes, message: 'This file does not contain a JSON value.' }
	}
	try {
		return { kind: 'value', value: JSON.parse(source) as JsonValue, source, sourceBytes }
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'Invalid JSON'
		return {
			kind: 'fallback',
			reason: 'invalid',
			source,
			sourceBytes,
			message: `This file is not valid JSON: ${detail}`,
		}
	}
}

export function parseJsonlArtifact(source: string): JsonlParseResult {
	const sourceBytes = getSourceBytes(source)
	if (sourceBytes > MAX_STRUCTURED_SOURCE_BYTES) return sourceSizeFallback(source, sourceBytes)
	if (source === '') {
		return {
			kind: 'fallback',
			reason: 'empty',
			source,
			sourceBytes,
			message: 'This file does not contain any JSONL records.',
		}
	}

	const records: JsonlRecord[] = []
	let structuredNodes = 0
	let sourceLine = 1
	let lineStart = 0
	while (lineStart < source.length) {
		if (structuredNodes >= MAX_STRUCTURED_NODES) return jsonlNodeLimitFallback(source, sourceBytes)
		const newline = source.indexOf('\n', lineStart)
		const lineEnd = newline === -1 ? source.length : newline
		const line = source.slice(lineStart, lineEnd)
		if (line.trim() === '') {
			records.push({ kind: 'blank', sourceLine })
			structuredNodes++
		} else try {
			const value = JSON.parse(line) as JsonValue
			const recordNodes = 1 + countJsonNodes(value, MAX_STRUCTURED_NODES - structuredNodes - 1)
			if (structuredNodes + recordNodes > MAX_STRUCTURED_NODES) {
				return jsonlNodeLimitFallback(source, sourceBytes)
			}
			records.push({ kind: 'value', sourceLine, value })
			structuredNodes += recordNodes
		} catch (error) {
			records.push({
				kind: 'invalid',
				sourceLine,
				source: line,
				message: error instanceof Error ? error.message : 'Invalid JSON',
			})
			structuredNodes++
		}
		sourceLine++
		if (newline === -1) break
		lineStart = newline + 1
	}

	return { kind: 'records', records, source, sourceBytes }
}
