export const logLevels = {
	silly: 10,
	debug: 20,
	http: 25,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
} as const
export type LogLevel = keyof typeof logLevels

export type JsonValue<
	D extends number = 8, // max depth
	A extends Array<0> = [], // accumulator
> =
	| null
	| boolean
	| number
	| string
	| (A['length'] extends D ? unknown : Array<JsonValue<D, [0, ...A]>>) // arrays
	| (A['length'] extends D ? unknown : { [k: string]: JsonValue<D, [0, ...A]> }) // objects

export type JsonObject = Record<string, JsonValue>
