import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { parseSessionFromTrailer, SESSION_TRAILER_TOKEN } from './session-trailer'

/**
 * The read-side UUID gate exists so nothing reaches the server that the recordObserved
 * contract's z.uuid() would reject — a single rejected sessionId fails the WHOLE batch at input
 * validation and wedges that repo's watermark loop (the 2026-07-10 incident class). The gate IS
 * z.uuid() (same lib), so this suite pins the end-to-end agreement: for any id riding a trailer
 * URL, parse succeeds exactly when the contract would accept the id.
 */

const trailerBody = (id: string) => `did the thing\n\n${SESSION_TRAILER_TOKEN}: https://app.test/sessions/${id}`

describe('parseSessionFromTrailer UUID gate vs the contract', () => {
	const candidates = [
		'018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f', // real v7
		'018F9C2E-7A3B-7C1D-9E2F-3A4B5C6D7E8F', // uppercase form
		'00000000-0000-0000-0000-000000000000', // nil (zod accepts)
		'ffffffff-ffff-ffff-ffff-ffffffffffff', // max (zod accepts)
		'aaaaaaaa-aaaa-0aaa-9aaa-aaaaaaaaaaaa', // version nibble 0 (zod rejects)
		'aaaaaaaa-aaaa-9aaa-9aaa-aaaaaaaaaaaa', // version nibble 9 (zod rejects)
		'aaaaaaaa-aaaa-7aaa-caaa-aaaaaaaaaaaa', // variant nibble c (zod rejects)
		'aaaaaaaa-aaaa-7aaa-0aaa-aaaaaaaaaaaa', // variant nibble 0 (zod rejects)
		'018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e', // too short
		'018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f00', // too long
		'018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7g8f', // non-hex
		'oops-not-a-uuid',
	]

	test.each(candidates)('gate agrees with z.uuid() on %s', (id) => {
		const contractAccepts = z.uuid().safeParse(id).success
		const parsed = parseSessionFromTrailer(trailerBody(id))
		// Never looser than the contract (a pass here + reject there wedges the batch), and never
		// tighter either (a real session id must always attribute as confirmed).
		expect(parsed !== undefined).toBe(contractAccepts)
		if (contractAccepts) expect(parsed).toBe(id)
	})
})
