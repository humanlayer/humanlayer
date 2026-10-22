import { Schema } from 'effect'

export const BUILD_TYPES = ['local', 'dev', 'beta', 'prod'] as const
export const BuildType = Schema.Literals(BUILD_TYPES)
