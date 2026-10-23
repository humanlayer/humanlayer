import { Layer, ManagedRuntime } from "effect";

export type EffectRuntimeSource<TRequirementsProvided, TRuntimeError> =
  | ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>
  | Layer.Layer<TRequirementsProvided, TRuntimeError, never>;

export function toManagedRuntime<TRequirementsProvided, TRuntimeError>(
  source: EffectRuntimeSource<TRequirementsProvided, TRuntimeError>,
): ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError> {
  return ManagedRuntime.isManagedRuntime(source)
    ? (source as ManagedRuntime.ManagedRuntime<
        TRequirementsProvided,
        TRuntimeError
      >)
    : ManagedRuntime.make(
        source as Layer.Layer<TRequirementsProvided, TRuntimeError, never>,
      );
}
