declare const Effect: {
	catchTag: (tag: string, handler: (error: unknown) => unknown) => unknown
}
declare const Match: {
	when: (pattern: object, handler: () => unknown) => unknown
}
declare const Predicate: {
	isTagged: (value: unknown, tag: string) => boolean
}
declare const Ready: {
	make: (fields: { value: number }) => unknown
}
declare const value: unknown

Predicate.isTagged(value, 'Ready')
Match.when({ _tag: 'Ready' }, () => undefined)
Effect.catchTag('NotFoundError', () => undefined)
Ready.make({ value: 1 })

type Tagged = { readonly _tag: 'Ready'; readonly value: number }
declare const tagged: Tagged
void tagged
