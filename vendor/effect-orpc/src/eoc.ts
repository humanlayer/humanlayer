import type {
  AnySchema,
  ContractProcedure,
  ContractRouter,
  ErrorMap,
  HTTPPath,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import { isContractProcedure, oc } from "@orpc/contract";

import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type { EffectErrorMapToErrorMap } from "./types";

export const effectContractSymbol: unique symbol = Symbol.for(
  "@orpc/effect/contract",
);

interface EffectContractMetadata<TEffectErrorMap extends EffectErrorMap> {
  readonly [effectContractSymbol]: {
    readonly errorMap: TEffectErrorMap;
  };
}

type LocalEffectErrorMap<T> =
  T extends EffectContractMetadata<infer TEffectErrorMap extends EffectErrorMap>
    ? TEffectErrorMap
    : Record<never, never>;

type ContractWithEffectErrorMap<T, TEffectErrorMap extends EffectErrorMap> =
  T extends ContractProcedure<
    infer TInputSchema,
    infer TOutputSchema,
    infer TErrorMap extends ErrorMap,
    infer TMeta extends Meta
  >
    ? ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> &
        EffectContractMetadata<
          MergedEffectErrorMap<TEffectErrorMap, LocalEffectErrorMap<T>>
        >
    : T extends ContractRouter<Meta>
      ? {
          [K in keyof T]: ContractWithEffectErrorMap<T[K], TEffectErrorMap>;
        }
      : never;

export interface EffectContractProcedureBuilder<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>
  extends
    ContractProcedure<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
    EffectContractMetadata<TEffectErrorMap> {
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractProcedureBuilder<
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  meta(
    meta: TMeta,
  ): EffectContractProcedureBuilder<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  route(
    route: Route,
  ): EffectContractProcedureBuilder<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  input<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithInput<
    U,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  output<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithOutput<
    TInputSchema,
    U,
    TEffectErrorMap,
    TMeta
  >;
}

export interface EffectContractProcedureBuilderWithInput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>
  extends
    ContractProcedure<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
    EffectContractMetadata<TEffectErrorMap> {
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractProcedureBuilderWithInput<
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  meta(
    meta: TMeta,
  ): EffectContractProcedureBuilderWithInput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  route(
    route: Route,
  ): EffectContractProcedureBuilderWithInput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  output<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithInputOutput<
    TInputSchema,
    U,
    TEffectErrorMap,
    TMeta
  >;
}

export interface EffectContractProcedureBuilderWithOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>
  extends
    ContractProcedure<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
    EffectContractMetadata<TEffectErrorMap> {
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractProcedureBuilderWithOutput<
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  meta(
    meta: TMeta,
  ): EffectContractProcedureBuilderWithOutput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  route(
    route: Route,
  ): EffectContractProcedureBuilderWithOutput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  input<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithInputOutput<
    U,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
}

export interface EffectContractProcedureBuilderWithInputOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>
  extends
    ContractProcedure<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
    EffectContractMetadata<TEffectErrorMap> {
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractProcedureBuilderWithInputOutput<
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  meta(
    meta: TMeta,
  ): EffectContractProcedureBuilderWithInputOutput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  route(
    route: Route,
  ): EffectContractProcedureBuilderWithInputOutput<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
}

export interface EffectContractRouterBuilder<
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> extends EffectContractMetadata<TEffectErrorMap> {
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractRouterBuilder<
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  prefix(prefix: HTTPPath): EffectContractRouterBuilder<TEffectErrorMap, TMeta>;
  tag(...tags: string[]): EffectContractRouterBuilder<TEffectErrorMap, TMeta>;
  router<T extends ContractRouter<TMeta>>(
    router: T,
  ): ContractWithEffectErrorMap<T, TEffectErrorMap>;
}

export interface EffectContractBuilder<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>
  extends
    ContractProcedure<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
      TMeta
    >,
    EffectContractMetadata<TEffectErrorMap> {
  $meta<U extends Meta>(
    initialMeta: U,
  ): EffectContractBuilder<TInputSchema, TOutputSchema, TEffectErrorMap, U>;
  $route(
    initialRoute: Route,
  ): EffectContractBuilder<TInputSchema, TOutputSchema, TEffectErrorMap, TMeta>;
  $input<U extends AnySchema>(
    initialInputSchema?: U,
  ): EffectContractBuilder<U, TOutputSchema, TEffectErrorMap, TMeta>;
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectContractBuilder<
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta
  >;
  meta(
    meta: TMeta,
  ): EffectContractProcedureBuilder<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  route(
    route: Route,
  ): EffectContractProcedureBuilder<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  input<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithInput<
    U,
    TOutputSchema,
    TEffectErrorMap,
    TMeta
  >;
  output<U extends AnySchema>(
    schema: U,
  ): EffectContractProcedureBuilderWithOutput<
    TInputSchema,
    U,
    TEffectErrorMap,
    TMeta
  >;
  prefix(prefix: HTTPPath): EffectContractRouterBuilder<TEffectErrorMap, TMeta>;
  tag(...tags: string[]): EffectContractRouterBuilder<TEffectErrorMap, TMeta>;
  router<T extends ContractRouter<TMeta>>(
    router: T,
  ): ContractWithEffectErrorMap<T, TEffectErrorMap>;
}

function isWrappableContractBuilder(value: unknown): value is {
  "~orpc": { errorMap: ErrorMap };
} {
  return typeof value === "object" && value !== null && "~orpc" in value;
}

function mergeEffectErrorMaps(
  left: EffectErrorMap | undefined,
  right: EffectErrorMap | undefined,
): EffectErrorMap | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    ...left,
    ...right,
  };
}

function setEffectContractErrorMap(
  value: object,
  effectErrorMap: EffectErrorMap | undefined,
): void {
  if (!effectErrorMap) {
    return;
  }

  Object.defineProperty(value, effectContractSymbol, {
    value: { errorMap: effectErrorMap },
    enumerable: false,
    configurable: true,
  });
}

export function getEffectContractErrorMap(
  value: unknown,
): EffectErrorMap | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as Partial<EffectContractMetadata<EffectErrorMap>>)[
    effectContractSymbol
  ]?.errorMap;
}

function applyEffectContractErrorMapToRouter(
  router: ContractRouter<Meta>,
  source: ContractRouter<Meta> | undefined,
  inheritedEffectErrorMap: EffectErrorMap | undefined,
): void {
  const routerRecord = router as Record<string, ContractRouter<Meta>>;
  const sourceRecord = source as
    | Record<string, ContractRouter<Meta>>
    | undefined;

  for (const key of Object.keys(routerRecord)) {
    const routerValue = routerRecord[key];
    const sourceValue =
      sourceRecord && typeof sourceRecord === "object"
        ? sourceRecord[key]
        : undefined;

    if (!routerValue) {
      continue;
    }

    if (isContractProcedure(routerValue)) {
      const sourceEffectErrorMap = getEffectContractErrorMap(sourceValue);
      setEffectContractErrorMap(
        routerValue,
        mergeEffectErrorMaps(inheritedEffectErrorMap, sourceEffectErrorMap),
      );
      continue;
    }

    if (typeof routerValue === "object") {
      applyEffectContractErrorMapToRouter(
        routerValue,
        sourceValue as ContractRouter<Meta> | undefined,
        inheritedEffectErrorMap,
      );
    }
  }
}

function wrapEffectContractBuilder<T>(
  builder: T,
  inheritedEffectErrorMap?: EffectErrorMap,
): T {
  const currentEffectErrorMap =
    inheritedEffectErrorMap ?? getEffectContractErrorMap(builder);

  if (typeof builder === "object" && builder !== null) {
    setEffectContractErrorMap(builder as object, currentEffectErrorMap);
  }

  const proxy = new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === effectContractSymbol) {
        return currentEffectErrorMap
          ? { errorMap: currentEffectErrorMap }
          : undefined;
      }

      if (prop === "errors") {
        return (errors: EffectErrorMap) => {
          const nextEffectErrorMap = mergeEffectErrorMaps(
            currentEffectErrorMap,
            errors,
          );

          return wrapEffectContractBuilder(
            Reflect.apply(Reflect.get(target, prop, receiver), target, [
              effectErrorMapToErrorMap(errors),
            ]),
            nextEffectErrorMap,
          );
        };
      }

      if (prop === "router") {
        return (router: ContractRouter<Meta>) => {
          const result = Reflect.apply(
            Reflect.get(target, prop, receiver),
            target,
            [router],
          ) as ContractRouter<Meta>;

          applyEffectContractErrorMapToRouter(
            result,
            router,
            currentEffectErrorMap,
          );

          return result;
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        return isWrappableContractBuilder(result)
          ? wrapEffectContractBuilder(result, currentEffectErrorMap)
          : result;
      };
    },
  }) as T;

  setEffectContractErrorMap(proxy as object, currentEffectErrorMap);

  return proxy;
}

export const eoc = wrapEffectContractBuilder(
  oc,
  {},
) as unknown as EffectContractBuilder<
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>,
  Record<never, never>
>;
