/**
 * This file patches JSON stringification for various objects
 */

// @ts-expect-error - this is safe, typescript just doesn't like it.
BigInt.prototype.toJSON = function () {
	return this.toString()
}
