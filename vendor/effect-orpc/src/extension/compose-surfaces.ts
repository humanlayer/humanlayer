export function composeSurfaceProxy<
  TSurface extends object,
  TTarget extends object,
>(surface: TSurface, target: TTarget): TSurface & TTarget {
  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      return Reflect.has(surface, prop)
        ? Reflect.get(surface, prop, surface)
        : Reflect.get(currentTarget, prop, receiver);
    },
    has(currentTarget, prop) {
      return Reflect.has(surface, prop) || Reflect.has(currentTarget, prop);
    },
  }) as TSurface & TTarget;
}
