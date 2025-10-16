import { toBase64 } from "lib0/buffer"
import * as decoding from "lib0/decoding"

const hexStringToUint8Array = (hexString: string) => {
  const cleanHexString = hexString.startsWith(`\\x`)
    ? hexString.slice(2)
    : hexString
  return new Uint8Array(
    cleanHexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  )
}

export const parseToUint8Array = {
  bytea: hexStringToUint8Array,
}

export const parseToBase64 = {
  bytea: (hexString: string) => {
    const uint8Array = hexStringToUint8Array(hexString)
    return toBase64(uint8Array)
  },
}

export const parseToDecoder = {
  bytea: (hexString: string) => {
    const uint8Array = hexStringToUint8Array(hexString)
    return decoding.createDecoder(uint8Array)
  },
}

export const parseToDecoderLazy = {
  bytea: (hexString: string) => () => {
    const uint8Array = hexStringToUint8Array(hexString)
    return decoding.createDecoder(uint8Array)
  },
}

export const paserToTimestamptz = {
  timestamptz: (timestamp: string) => {
    return new Date(timestamp)
  },
}
