import type {
  ORPCErrorCode,
  ORPCErrorJSON,
  ORPCErrorOptions,
} from "@orpc/client";
import {
  fallbackORPCErrorMessage,
  fallbackORPCErrorStatus,
  isORPCErrorStatus,
  ORPCError,
} from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  InferSchemaOutput,
} from "@orpc/contract";
import type { MaybeOptionalOptions } from "@orpc/shared";
import { resolveMaybeOptionalOptions } from "@orpc/shared";
import type { Pipeable } from "effect";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";

import type { EffectErrorMapToErrorMap } from "./types";

/**
 * Symbol to access the underlying ORPCError instance
 */
export const ORPCErrorSymbol: unique symbol = Symbol.for(
  "@orpc/effect/ORPCTaggedError",
);

/**
 * Instance type for ORPCTaggedError that combines YieldableError with ORPCError properties
 */
export interface ORPCTaggedErrorInstance<
  TTag extends string,
  TCode extends ORPCErrorCode,
  TSchema extends AnySchema = AnySchema,
>
  extends Cause.YieldableError, Pipeable.Pipeable {
  readonly _tag: TTag;
  readonly code: TCode;
  readonly status: number;
  readonly schema: TSchema;
  readonly data: InferSchemaOutput<TSchema>;
  readonly defined: boolean;
  readonly [ORPCErrorSymbol]: ORPCError<TCode, InferSchemaOutput<TSchema>>;

  toJSON(): ORPCErrorJSON<TCode, InferSchemaOutput<TSchema>> & { _tag: TTag };
  toORPCError(): ORPCError<TCode, InferSchemaOutput<TSchema>>;
}

/**
 * Options for creating an ORPCTaggedError
 */
export type ORPCTaggedErrorOptions<TData> = Omit<
  ORPCErrorOptions<TData>,
  "defined"
> & { defined?: boolean };

/**
 * Constructor type for ORPCTaggedError classes
 */
export interface ORPCTaggedErrorClass<
  TTag extends string,
  TCode extends ORPCErrorCode,
  TSchema extends AnySchema = AnySchema,
> {
  readonly _tag: TTag;
  readonly code: TCode;
  new (
    ...args: MaybeOptionalOptions<
      ORPCTaggedErrorOptions<InferSchemaOutput<TSchema>>
    >
  ): ORPCTaggedErrorInstance<TTag, TCode, TSchema>;
}

/**
 * Type helper to infer the ORPCError type from an ORPCTaggedError
 */
export type InferORPCError<T> =
  T extends ORPCTaggedErrorInstance<string, infer TCode, infer TSchema>
    ? ORPCError<TCode, InferSchemaOutput<TSchema>>
    : never;

/**
 * Any ORPCTaggedErrorClass
 * Uses `...args: any[]` for the constructor to accept any tagged error class,
 * regardless of whether TData requires options to be provided.
 */
export type AnyORPCTaggedErrorClass = {
  readonly _tag: string;
  readonly code: ORPCErrorCode;
  new (
    ...args: any[]
  ): ORPCTaggedErrorInstance<string, ORPCErrorCode, AnySchema>;
};

/**
 * Check if a value is an ORPCTaggedErrorClass (constructor)
 */
export function isORPCTaggedErrorClass(
  value: unknown,
): value is AnyORPCTaggedErrorClass {
  return (
    typeof value === "function" &&
    "_tag" in value &&
    "code" in value &&
    typeof value._tag === "string" &&
    typeof value.code === "string"
  );
}

/**
 * Check if a value is an ORPCTaggedError instance
 */
export function isORPCTaggedError(
  value: unknown,
): value is ORPCTaggedErrorInstance<string, ORPCErrorCode, AnySchema> {
  return (
    typeof value === "object" && value !== null && ORPCErrorSymbol in value
  );
}

/**
 * Converts a PascalCase or camelCase string to CONSTANT_CASE.
 * e.g., "UserNotFoundError" -> "USER_NOT_FOUND_ERROR"
 */
function toConstantCase<T extends string>(str: T): ToConstantCase<T> {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toUpperCase() as ToConstantCase<T>;
}
/**
 * Checks if a character is an uppercase letter (A-Z)
 */
type IsUpperLetter<C extends string> =
  C extends Uppercase<C>
    ? C extends Lowercase<C>
      ? false // Not a letter (number, special char)
      : true
    : false;

/**
 * Checks if a character is a lowercase letter (a-z)
 */
type IsLowerLetter<C extends string> =
  C extends Lowercase<C>
    ? C extends Uppercase<C>
      ? false // Not a letter (number, special char)
      : true
    : false;

/**
 * Converts PascalCase or camelCase to CONSTANT_CASE.
 * Handles consecutive uppercase letters correctly.
 *
 * @example
 * type T1 = ToConstantCase<"ABCCode">; // "ABC_CODE"
 * type T2 = ToConstantCase<"UserCode">; // "USER_CODE"
 * type T3 = ToConstantCase<"XMLHttpRequest">; // "XML_HTTP_REQUEST"
 */
type ToConstantCase<
  S extends string,
  Acc extends string = "",
  PrevChar extends string = "",
  InUpperSequence extends boolean = false,
> = S extends `${infer Head}${infer Tail}`
  ? IsUpperLetter<Head> extends true
    ? Acc extends ""
      ? // First character - no underscore
        ToConstantCase<Tail, Head, Head, false>
      : PrevChar extends ""
        ? // Shouldn't happen, but handle gracefully
          ToConstantCase<Tail, Head, Head, false>
        : IsUpperLetter<PrevChar> extends true
          ? // We're in an uppercase sequence
            Tail extends `${infer Next}${infer _}`
            ? IsLowerLetter<Next> extends true
              ? // Next char is lowercase, so Head starts a new word - insert underscore
                ToConstantCase<Tail, `${Acc}_${Head}`, Head, false>
              : // Next char is uppercase or non-letter - continue sequence
                ToConstantCase<Tail, `${Acc}${Head}`, Head, true>
            : // Tail is empty - just append
              ToConstantCase<Tail, `${Acc}${Head}`, Head, true>
          : // Transition from lowercase to uppercase - insert underscore
            ToConstantCase<Tail, `${Acc}_${Head}`, Head, false>
    : IsLowerLetter<Head> extends true
      ? InUpperSequence extends true
        ? // End of uppercase sequence (2+) - insert underscore before lowercase
          ToConstantCase<Tail, `${Acc}_${Uppercase<Head>}`, Head, false>
        : // Single uppercase or no uppercase - no underscore
          ToConstantCase<Tail, `${Acc}${Uppercase<Head>}`, Head, false>
      : // Non-letter character - reset sequence
        ToConstantCase<Tail, `${Acc}${Head}`, Head, false>
  : Acc;

/**
 * Converts a tag name to an error code in CONSTANT_CASE.
 */
export type TagToCode<TTag extends string> = ToConstantCase<TTag>;

/**
 * Creates a tagged error class that combines Effect's YieldableError with ORPCError.
 *
 * This allows you to create errors that:
 * - Can be yielded in Effect generators (`yield* myError`)
 * - Have all ORPCError properties (code, status, data, defined)
 * - Can be converted to a plain ORPCError for oRPC handlers
 *
 * The returned factory function takes:
 * - `tag` - The unique tag for this error type (used for discriminated unions)
 * - `codeOrOptions` - Optional ORPC error code or options. If omitted, code defaults to CONSTANT_CASE of tag
 * - `defaultOptions` - Optional default options for status and message (when code is provided)
 *
 * @example
 * ```ts
 * import { ORPCTaggedError } from '@orpc/effect'
 * import { Effect } from 'effect'
 *
 * // Define a custom error (code defaults to 'USER_NOT_FOUND_ERROR')
 * class UserNotFoundError extends ORPCTaggedError<UserNotFoundError>()('UserNotFoundError') {}
 *
 * // With explicit code
 * class NotFoundError extends ORPCTaggedError<NotFoundError>()('NotFoundError', 'NOT_FOUND') {}
 *
 * // Use in an Effect
 * const getUser = (id: string) => Effect.gen(function* () {
 *   const user = yield* findUser(id)
 *   if (!user) {
 *     return yield* new UserNotFoundError({ data: { userId: id } })
 *   }
 *   return user
 * })
 *
 * // With custom data type
 * class ValidationError extends ORPCTaggedError<ValidationError, { fields: string[] }>()('ValidationError', 'BAD_REQUEST') {}
 *
 * // With options only (code defaults to 'VALIDATION_ERROR')
 * class ValidationError2 extends ORPCTaggedError<ValidationError2, { fields: string[] }>()(
 *   'ValidationError2',
 *   { message: 'Validation failed' }
 * ) {}
 * ```
 */
export function ORPCTaggedError<
  TTag extends string,
  TSchema extends AnySchema = AnySchema,
  TCode extends ORPCErrorCode = ToConstantCase<TTag>,
>(
  tag: TTag,
  props?: {
    schema?: TSchema;
    status?: number;
    message?: string;
    code?: TCode;
  },
): ORPCTaggedErrorClass<TTag, TCode, TSchema> {
  const code: TCode = props?.code ?? (toConstantCase(tag) as any);
  class ORPCTaggedErrorBase
    extends Data.TaggedError(tag)
    implements ORPCTaggedErrorInstance<TTag, TCode, TSchema>
  {
    readonly status: number;
    readonly defined: boolean;
    readonly data: InferSchemaOutput<TSchema>;
    readonly code: TCode = code;
    readonly schema = props?.schema as TSchema;
    readonly [ORPCErrorSymbol]: ORPCError<TCode, InferSchemaOutput<TSchema>>;

    constructor(
      ...rest: MaybeOptionalOptions<
        ORPCTaggedErrorOptions<InferSchemaOutput<TSchema>>
      >
    ) {
      super();

      const opts = resolveMaybeOptionalOptions(rest);
      const status = opts.status ?? props?.status;

      if (status !== undefined && !isORPCErrorStatus(status)) {
        throw new globalThis.Error(
          "[ORPCTaggedError] Invalid error status code.",
        );
      }

      this.status = fallbackORPCErrorStatus(code, status);
      this.defined = opts.defined ?? true;
      this.data = opts.data as InferSchemaOutput<TSchema>;
      this.message = fallbackORPCErrorMessage(
        this.code,
        opts.message ?? props?.message,
      );
      this.cause = opts.cause;

      this[ORPCErrorSymbol] = new ORPCError<TCode, InferSchemaOutput<TSchema>>(
        this.code,
        {
          status: this.status,
          message: this.message,
          data: this.data,
          defined: this.defined,
          cause: this.cause,
        },
      );
    }

    /**
     * Converts this error to a plain ORPCError.
     * Useful when you need to return from an oRPC handler.
     */
    toORPCError(): ORPCError<TCode, InferSchemaOutput<TSchema>> {
      return this[ORPCErrorSymbol];
    }

    override toJSON(): ORPCErrorJSON<TCode, InferSchemaOutput<TSchema>> & {
      _tag: TTag;
    } {
      return {
        _tag: this._tag,
        defined: this[ORPCErrorSymbol].defined,
        code: this[ORPCErrorSymbol].code,
        status: this[ORPCErrorSymbol].status,
        message: this[ORPCErrorSymbol].message,
        data: this[ORPCErrorSymbol].data,
      };
    }
  }

  return Object.assign(ORPCTaggedErrorBase, {
    _tag: tag,
    code,
  } as const);
}

/**
 * Converts an ORPCTaggedError to a plain ORPCError.
 * Useful in handlers that need to throw ORPCError.
 *
 * @example
 * ```ts
 * const handler = effectOs.effect(function* () {
 *   const result = yield* someOperation.pipe(
 *     Effect.catchTag('UserNotFoundError', (e) =>
 *       Effect.fail(toORPCError(e))
 *     )
 *   )
 *   return result
 * })
 * ```
 */
export function toORPCError<
  TCode extends ORPCErrorCode,
  TSchema extends AnySchema = AnySchema,
>(
  error: ORPCTaggedErrorInstance<string, TCode, TSchema>,
): ORPCError<TCode, InferSchemaOutput<TSchema>> {
  return error[ORPCErrorSymbol];
}

// ============================================================================
// Extended Error Map Types for Effect
// ============================================================================

/**
 * An item in the EffectErrorMap - can be either a traditional ErrorMapItem or an ORPCTaggedErrorClass
 */
export type EffectErrorMapItem =
  | ErrorMapItem<AnySchema>
  | AnyORPCTaggedErrorClass;

/**
 * Extended error map that supports both traditional oRPC errors and ORPCTaggedError classes.
 *
 * @example
 * ```ts
 * const errorMap = {
 *   // Traditional format
 *   BAD_REQUEST: { status: 400, message: 'Bad request' },
 *
 *   // Tagged error class reference
 *   USER_NOT_FOUND: UserNotFoundError,
 * } satisfies EffectErrorMap
 * ```
 */
export type EffectErrorMap = {
  [key in ORPCErrorCode]?: EffectErrorMapItem;
};

/**
 * Merges two EffectErrorMaps, with the second map taking precedence.
 */
export type MergedEffectErrorMap<
  T1 extends EffectErrorMap,
  T2 extends EffectErrorMap,
> = Omit<T1, keyof T2> & T2;

/**
 * Extracts the instance type from an EffectErrorMapItem
 */
export type EffectErrorMapItemToInstance<
  TCode extends ORPCErrorCode,
  T extends EffectErrorMapItem,
> = T extends AnyORPCTaggedErrorClass
  ? InstanceType<T>
  : T extends { data?: infer TData }
    ? ORPCError<TCode, TData>
    : ORPCError<TCode, unknown>;

/**
 * Converts an EffectErrorMap to a union of error instances.
 */
export type EffectErrorMapToUnion<T extends EffectErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends EffectErrorMapItem
      ? EffectErrorMapItemToInstance<K, T[K]>
      : never
    : never;
}[keyof T];

/**
 * Constructor map for EffectErrorMap - provides typed error constructors for handlers.
 */
type EffectErrorConstructor<
  TCode extends ORPCErrorCode,
  TItem,
> = TItem extends AnyORPCTaggedErrorClass
  ? (...args: ConstructorParameters<TItem>) => InstanceType<TItem>
  : TItem extends { data?: infer TSchema extends AnySchema }
    ? (
        ...rest: MaybeOptionalOptions<
          Omit<
            ORPCErrorOptions<InferSchemaOutput<TSchema>>,
            "defined" | "status"
          >
        >
      ) => ORPCError<TCode, InferSchemaOutput<TSchema>>
    : (
        ...rest: MaybeOptionalOptions<
          Omit<ORPCErrorOptions<unknown>, "defined" | "status">
        >
      ) => ORPCError<TCode, unknown>;

export type EffectErrorConstructorMap<T extends EffectErrorMap> = {
  [K in Extract<keyof T, ORPCErrorCode>]: EffectErrorConstructor<K, T[K]>;
};

/**
 * Creates an error constructor map from an EffectErrorMap.
 * Tagged error classes are passed through directly.
 * Traditional error items become ORPCError factory functions.
 */
export function createEffectErrorConstructorMap<T extends EffectErrorMap>(
  errors: T | undefined,
): EffectErrorConstructorMap<T> {
  const target = errors ?? ({} as T);
  const proxy = new Proxy(target, {
    get(proxyTarget, code) {
      if (typeof code !== "string") {
        return Reflect.get(proxyTarget, code);
      }

      const config = target[code];

      // If it's a tagged error class, create a class constructor function
      if (isORPCTaggedErrorClass(config)) {
        return (
          ...opts: MaybeOptionalOptions<ORPCTaggedErrorOptions<unknown>>
        ) => new config(...opts);
      }

      // Otherwise, create a factory function for ORPCError
      return (
        ...rest: MaybeOptionalOptions<
          Omit<ORPCErrorOptions<unknown>, "defined" | "status">
        >
      ) => {
        const options = resolveMaybeOptionalOptions(rest);
        return new ORPCError(code, {
          defined: Boolean(config),
          status: config?.status,
          message: options.message ?? config?.message,
          data: options.data,
          cause: options.cause,
        });
      };
    },
  });

  return proxy as unknown as EffectErrorConstructorMap<T>;
}

/**
 * Converts an EffectErrorMap to a standard oRPC ErrorMap for interop.
 * Tagged error classes are converted to their equivalent ErrorMapItem format.
 */
export function effectErrorMapToErrorMap<T extends EffectErrorMap>(
  errorMap: T | undefined,
): EffectErrorMapToErrorMap<T> {
  const result: ErrorMap = {};

  if (!errorMap) {
    return result as ErrorMap & EffectErrorMapToErrorMap<T>;
  }

  for (const [code, ClassOrErrorItem] of Object.entries(errorMap)) {
    if (!ClassOrErrorItem) {
      continue;
    }

    if (isORPCTaggedErrorClass(ClassOrErrorItem)) {
      const classInstance = new ClassOrErrorItem();
      result[classInstance.code] = {
        status: classInstance.status,
        message: classInstance.message,
        data: classInstance.schema,
      };
    } else {
      result[code] = ClassOrErrorItem;
    }
  }

  return result as ErrorMap & EffectErrorMapToErrorMap<T>;
}
