import { Layer, ManagedRuntime } from "effect";

import { eoc } from "../index";
import {
  baseErrorMap,
  baseMeta,
  inputSchema,
  outputSchema,
  pong,
} from "./shared";

export type InitialContext = { db: string };
export type CurrentContext = InitialContext & { auth: boolean };

export const runtime = ManagedRuntime.make(Layer.empty);

export const typedContract = {
  ping: eoc
    .errors(baseErrorMap)
    .meta(baseMeta)
    .input(inputSchema)
    .output(outputSchema),
  pong,
  nested: {
    ping: eoc
      .errors(baseErrorMap)
      .meta(baseMeta)
      .input(inputSchema)
      .output(outputSchema),
    pong,
  },
};
