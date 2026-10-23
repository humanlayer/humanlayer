// Pure unit tests for src/util.ts's helpers, and the id and text helpers it used to hold. Covers plan.md §9's util.test.ts
// bullet list: nameUuid is stable and v5-shaped; ohash matches known values;
// UTF-8 cut; JWT decode.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { cutUtf8 } from '@humanlayer/session-sdk-base'
import { eventUuid as nameUuid } from '@humanlayer/session-sdk-sessions'

import { decodeJwtPayload, ohash } from '../src/util.ts'

function fakeJwtWithPayload(payload: unknown): string {
	const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
	return `header.${segment}.signature`
}

test('nameUuid is stable for the same name and shaped like a v5 UUID', () => {
	const a = nameUuid('humanlayer/pi/session-abc')
	const b = nameUuid('humanlayer/pi/session-abc')
	assert.equal(a, b)
	assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('nameUuid differs for different names', () => {
	assert.notEqual(nameUuid('a'), nameUuid('b'))
})

test('ohash matches an independently computed sha256(quote-wrapped) base64url digest', () => {
	const input = 'hello world'
	const expected = createHash('sha256').update(`'${input}'`, 'utf8').digest('base64url')
	assert.equal(ohash(input), expected)
})

test('ohash strips embedded NUL bytes before hashing', () => {
	assert.equal(ohash('a\0b'), ohash('ab'))
})

test('cutUtf8 returns strings at or under the limit unchanged', () => {
	assert.equal(cutUtf8('hello', 100), 'hello')
	assert.equal(cutUtf8('hello', 5), 'hello')
})

test('cutUtf8 truncates ASCII and reports the removed byte count', () => {
	assert.equal(cutUtf8('abcdefghij', 4), 'abcd…[truncated 6 bytes]')
})

test('cutUtf8 backs off rather than splitting a multi-byte character', () => {
	// 'a' (1 byte) + '€' (3 bytes) + 'b' (1 byte) = 5 bytes. Cutting at 2 lands inside '€'.
	const result = cutUtf8('a€b', 2)
	assert.equal(result, 'a…[truncated 4 bytes]')
})

test('decodeJwtPayload decodes the base64url payload segment', () => {
	const claims = { sub: 'user_1', exp: 1234567890, nested: { a: 1 } }
	assert.deepEqual(decodeJwtPayload(fakeJwtWithPayload(claims)), claims)
})

test('decodeJwtPayload rejects a token with no payload segment', () => {
	assert.throws(() => decodeJwtPayload('onlyoneseg'), /no payload segment/)
})

test("decodeJwtPayload rejects a payload that isn't a JSON object", () => {
	// typeof null === "object" too, so it needs its own explicit check; typeof [] === "object" as
	// well, so an array payload is accepted (decodeJwtPayload only guards against non-objects).
	assert.throws(() => decodeJwtPayload(fakeJwtWithPayload(42)), /payload is not an object/)
	assert.throws(() => decodeJwtPayload(fakeJwtWithPayload('just a string')), /payload is not an object/)
	assert.throws(() => decodeJwtPayload(fakeJwtWithPayload(null)), /payload is not an object/)
})
