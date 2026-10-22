// A task file's frontmatter: what riptide-daemon's gray-matter 4 (js-yaml 3) would give, for simple
// YAML only: top-level keys with plain, quoted, flow-list or block-list values. Anything else
// gives {}, which is also what the daemon sends when parsing fails. For hosts that can't ship gray-matter.

const UNSURE = Symbol('unsure')
type Scalar = string | number | boolean | null
type Value = Scalar | Scalar[]

// Characters js-yaml refuses or reads as line breaks.
const NON_PRINTABLE = /[\x00-\x08\x0B-\x1F\x7F-\x9F\u2028\u2029\uFFFE\uFFFF\p{Cs}]/u
// Numbers js-yaml reads that the plain decimal check below does not: signs, octal, hex, binary,
// underscores, base 60, exponents and .inf/.nan. Broad on purpose: a match only means "unsure".
const OTHER_NUMBER =
	/^(?:[-+]?(?:0b[01_]+|0x[\da-fA-F_]+|0[0-7_]+|(?:0|[1-9][\d_]*)(?::[0-5]?\d)*(?:\.[\d_]*)?(?:[eE][-+]?\d+)?|\.(?:inf|Inf|INF))|\.[\d_]+(?:[eE][-+]?\d+)?|\.(?:nan|NaN|NAN))$/
const DATE = /^(\d{4})-(\d\d)-(\d\d)$/
const DATETIME =
	/^(\d{4})-(\d\d?)-(\d\d?)(?:[Tt]|[ \t]+)(\d\d?):(\d\d):(\d\d)(?:\.(\d*))?(?:[ \t]*(Z|([-+])(\d\d?)(?::(\d\d))?))?$/
const ESCAPES = new Map([
	['\\', '\\'],
	['"', '"'],
	['/', '/'],
	['n', '\n'],
	['t', '\t'],
	['r', '\r'],
])

/** The frontmatter of a text file, or {} when there is none or it is not simple YAML. */
export function frontmatter(content: string): Record<string, unknown> {
	const text = content.replace(/^\uFEFF/, '')
	const open = /^---[ \t]*(?:ya?ml[ \t]*)?\r?\n/i.exec(text)
	if (!open) return {}
	const rest = text.slice(open[0].length)
	// gray-matter closes at the first line that starts with ---, else at the end.
	const close = rest.startsWith('---') ? 0 : rest.indexOf('\n---')
	const data = new Map<string, Value>()
	let key: string | undefined // the last key, when its value may be a block list
	let list: { indent: number; items: Scalar[] } | undefined
	for (const raw of (close < 0 ? rest : rest.slice(0, close)).split('\n')) {
		const line = raw.replace(/\r$/, '')
		if (NON_PRINTABLE.test(line)) return {}
		if (/^[ \t]*(?:#.*)?$/.test(line)) continue
		const item = /^( *)-(?:[ \t]+(.*))?$/.exec(line)
		if (item) {
			const indent = item[1]?.length ?? 0
			const value = scalar(item[2] ?? '')
			if (key === undefined || (list && list.indent !== indent) || value === UNSURE || Array.isArray(value))
				return {}
			if (!list) {
				list = { indent, items: [] }
				data.set(key, list.items)
			}
			list.items.push(value)
			continue
		}
		const pair = /^([A-Za-z_][\w.-]*):(?:[ \t]+(.*))?$/.exec(line)
		const name = pair?.[1]
		if (!pair || !name || data.has(name) || /^(?:true|false|null)$/i.test(name)) return {}
		const valueText = (pair[2] ?? '').trim()
		const value = scalar(valueText)
		if (value === UNSURE) return {}
		data.set(name, value)
		key = valueText === '' || valueText.startsWith('#') ? name : undefined
		list = undefined
	}
	return Object.fromEntries(data)
}

function scalar(raw: string): Value | typeof UNSURE {
	const s = raw.trim()
	if (s === '' || s.startsWith('#')) return null
	if (s.startsWith('"')) {
		const m = /^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/.exec(s)
		return m ? unescapeDouble(m[1] ?? '') : UNSURE
	}
	if (s.startsWith("'")) {
		const m = /^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/.exec(s)
		return m ? (m[1] ?? '').replaceAll("''", "'") : UNSURE
	}
	if (s.startsWith('[')) return flowList(s)
	const plain = s.replace(/[ \t]+#.*$/, '')
	if (/^[-?:](?:[ \t]|$)|^[,\]{}&*!|>%@`]|:(?:[ \t]|$)/.test(plain)) return UNSURE
	return plainScalar(plain)
}

function unescapeDouble(body: string): string | typeof UNSURE {
	let sure = true
	const out = body.replace(/\\(u[\da-fA-F]{4}|.)/g, (_, e: string) => {
		if (e.length === 5) return String.fromCharCode(Number.parseInt(e.slice(1), 16))
		const c = ESCAPES.get(e)
		if (c === undefined) sure = false
		return c ?? ''
	})
	return sure ? out : UNSURE
}

/** `[a, "b", 3]` on one line. Nested lists, maps and trailing commas are unsure. */
function flowList(s: string): Scalar[] | typeof UNSURE {
	const inner = /^\[(.*)\](?:[ \t]+#.*)?$/.exec(s)?.[1]
	if (inner === undefined) return UNSURE
	if (inner.trim() === '') return []
	const items: Scalar[] = []
	const next = /[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,"'[\]{}#]+)[ \t]*(,|$)/y
	while (next.lastIndex < inner.length) {
		const m = next.exec(inner)
		const value = m ? scalar(m[1] ?? '') : UNSURE
		if (!m || value === UNSURE || Array.isArray(value)) return UNSURE
		if (m[2] === ',' && next.lastIndex === inner.length) return UNSURE
		items.push(value)
	}
	return items
}

/** js-yaml 3's resolve order for plain scalars: null, bool, int, float, timestamp, else a string. */
function plainScalar(s: string): Scalar | typeof UNSURE {
	if (/^(?:~|null|Null|NULL)$/.test(s)) return null
	if (/^(?:true|True|TRUE)$/.test(s)) return true
	if (/^(?:false|False|FALSE)$/.test(s)) return false
	if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return Number(s)
	if (OTHER_NUMBER.test(s)) return UNSURE
	return timestamp(s) ?? s
}

/** A YAML timestamp as the ISO string a js-yaml Date becomes in JSON. */
function timestamp(s: string): string | undefined {
	const m = DATE.exec(s) ?? DATETIME.exec(s)
	if (!m) return undefined
	const n = (i: number) => Number(m[i] ?? 0)
	const ms = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'))
	let t = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6), ms)
	if (m[9]) t -= (m[9] === '-' ? -1 : 1) * (n(10) * 60 + n(11)) * 60_000
	return new Date(t).toISOString()
}
