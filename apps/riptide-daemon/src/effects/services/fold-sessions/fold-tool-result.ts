import { Match, Predicate } from 'effect'

type TextResult = { readonly _tag: 'text' | 'failure'; readonly text: string }
type MultipartResult = { readonly _tag: 'multipart'; readonly content: ReadonlyArray<unknown> }
type StringEnvelope = { readonly output?: string; readonly message?: string; readonly content?: string }

const hasStringProperty = <Key extends string>(value: unknown, key: Key): value is Record<Key, string> =>
	Predicate.hasProperty(value, key) && Predicate.isString(value[key])

const isTextResult = (value: unknown): value is TextResult =>
	(Predicate.isTagged(value, 'text') || Predicate.isTagged(value, 'failure')) && hasStringProperty(value, 'text')

const isMultipartResult = (value: unknown): value is MultipartResult =>
	Predicate.isTagged(value, 'multipart') && Predicate.hasProperty(value, 'content') && Array.isArray(value.content)

const isStringEnvelope = (value: unknown): value is StringEnvelope =>
	hasStringProperty(value, 'output') || hasStringProperty(value, 'message') || hasStringProperty(value, 'content')

const textParts = (content: ReadonlyArray<unknown>): string =>
	content
		.filter(
			(part): part is Record<'text', string> =>
				hasStringProperty(part, 'text') &&
				(Predicate.isTagged(part, 'text-part') ||
					(Predicate.hasProperty(part, 'type') && part.type === 'text')),
		)
		.map((part) => part.text)
		.join('\n')

const fallbackJson = (result: unknown): string => {
	const encoded = JSON.stringify(result)
	return Predicate.isString(encoded) ? encoded : String(result)
}

/** Render Fold's durable result for Riptide's text-only conversation event column. */
export const renderFoldToolResult = (result: unknown): string =>
	Match.value(result).pipe(
		Match.when(Predicate.isString, (text) => text),
		Match.when(isTextResult, (tagged) => tagged.text),
		Match.when(isMultipartResult, (multipart) => textParts(multipart.content)),
		Match.when(isStringEnvelope, (envelope) => envelope.output ?? envelope.message ?? envelope.content ?? ''),
		Match.when(
			(value: unknown): value is { readonly content: ReadonlyArray<unknown> } =>
				Predicate.hasProperty(value, 'content') && Array.isArray(value.content),
			(envelope) => textParts(envelope.content),
		),
		Match.orElse(fallbackJson),
	)
