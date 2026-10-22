import { fallbackORPCErrorMessage, ORPCError } from "@orpc/client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";

import { makeEffectORPC } from "../effect-builder";
import type {
  EffectErrorMap,
  EffectErrorMapToUnion,
  ORPCTaggedErrorInstance,
} from "../tagged-error";
import {
  createEffectErrorConstructorMap,
  effectErrorMapToErrorMap,
  isORPCTaggedError,
  isORPCTaggedErrorClass,
  ORPCTaggedError,
} from "../tagged-error";

const userNotFoundSchema = z.object({ userId: z.string() });
class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
  schema: userNotFoundSchema,
}) {}

class ValidationError extends ORPCTaggedError("ValidationError", {
  schema: z.object({ fields: z.array(z.string()) }),
  code: "BAD_REQUEST",
  message: "Validation failed",
}) {}
class PermissionDenied extends ORPCTaggedError("PermissionDenied", {
  code: "FORBIDDEN",
}) {}

describe("effectErrorMap types", () => {
  it("should accept both traditional and tagged error formats", () => {
    const errorMap = {
      // Traditional format
      BAD_REQUEST: { status: 400, message: "Bad request" },
      // Tagged error class references
      USER_NOT_FOUND_ERROR: UserNotFoundError,
      FORBIDDEN: PermissionDenied,
    } satisfies EffectErrorMap;

    expect(errorMap.BAD_REQUEST).toEqual({
      status: 400,
      message: "Bad request",
    });
    expect(errorMap.USER_NOT_FOUND_ERROR).toBe(UserNotFoundError);
    expect(errorMap.FORBIDDEN).toBe(PermissionDenied);
  });

  it("should infer correct union type from EffectErrorMap", () => {
    const zBadRequestData = z.object({
      status: z.number(),
      message: z.string(),
    });
    type TestErrorMap = {
      BAD_REQUEST: { data: typeof zBadRequestData };
      USER_NOT_FOUND_ERROR: typeof UserNotFoundError;
      FORBIDDEN: typeof PermissionDenied;
    };

    type ErrorUnion = EffectErrorMapToUnion<TestErrorMap>;

    // The union should include ORPCError for traditional and tagged error instances for classes
    expectTypeOf<ErrorUnion>().toExtend<
      | ORPCError<"BAD_REQUEST", typeof zBadRequestData>
      | ORPCTaggedErrorInstance<"UserNotFoundError", "USER_NOT_FOUND_ERROR">
      | ORPCTaggedErrorInstance<"PermissionDenied", "FORBIDDEN">
    >();
  });
});

describe("isORPCTaggedErrorClass", () => {
  it("should return true for tagged error classes", () => {
    expect(isORPCTaggedErrorClass(UserNotFoundError)).toBe(true);
    expect(isORPCTaggedErrorClass(ValidationError)).toBe(true);
    expect(isORPCTaggedErrorClass(PermissionDenied)).toBe(true);
  });

  it("should return false for non-tagged error classes", () => {
    expect(isORPCTaggedErrorClass(Error)).toBe(false);
    expect(isORPCTaggedErrorClass({})).toBe(false);
    expect(isORPCTaggedErrorClass(null)).toBe(false);
    expect(isORPCTaggedErrorClass(undefined)).toBe(false);
    expect(isORPCTaggedErrorClass(() => {})).toBe(false);
  });
});

describe("createEffectErrorConstructorMap", () => {
  it("preserves declaration keys even when a tagged error class uses a different code", () => {
    const errorMap = {
      NOT_FOUND: UserNotFoundError,
    } satisfies EffectErrorMap;

    const constructorMap = createEffectErrorConstructorMap(errorMap);
    const userNotFoundError = constructorMap.NOT_FOUND({
      data: { userId: "123" },
    });

    expect(constructorMap).not.toHaveProperty("USER_NOT_FOUND_ERROR");
    expect(userNotFoundError).toBeInstanceOf(UserNotFoundError);
    expect(userNotFoundError.code).toBe("USER_NOT_FOUND_ERROR");
  });

  it("should pass through tagged error classes", () => {
    const errorMap = {
      USER_NOT_FOUND_ERROR: UserNotFoundError,
      FORBIDDEN: PermissionDenied,
    } satisfies EffectErrorMap;

    const constructorMap = createEffectErrorConstructorMap(errorMap);

    const userNotFoundError = constructorMap.USER_NOT_FOUND_ERROR({
      data: { userId: "123" },
    });
    expect(userNotFoundError).toBeInstanceOf(UserNotFoundError);

    const forbiddenError = constructorMap.FORBIDDEN();
    expect(forbiddenError).toBeInstanceOf(PermissionDenied);
  });

  it("should create ORPCError factory for traditional items", () => {
    const errorMap = {
      BAD_REQUEST: { status: 400, message: "Bad request" },
      NOT_FOUND: { message: "Not found" },
    } satisfies EffectErrorMap;

    const constructorMap = createEffectErrorConstructorMap(errorMap);

    const badRequestError = constructorMap.BAD_REQUEST();
    expect(badRequestError).toBeInstanceOf(ORPCError);
    expect(badRequestError.code).toBe("BAD_REQUEST");
    expect(badRequestError.status).toBe(400);
    expect(badRequestError.message).toBe("Bad request");

    const notFoundError = constructorMap.NOT_FOUND();
    expect(notFoundError).toBeInstanceOf(ORPCError);
    expect(notFoundError.code).toBe("NOT_FOUND");
  });

  it("should work with mixed error map", () => {
    const errorMap = {
      BAD_REQUEST: { status: 400 },
      USER_NOT_FOUND_ERROR: UserNotFoundError,
    } satisfies EffectErrorMap;

    const constructorMap = createEffectErrorConstructorMap(errorMap);

    // Traditional error returns ORPCError
    const badRequestError = constructorMap.BAD_REQUEST({
      message: "Invalid input",
    });
    expect(badRequestError).toBeInstanceOf(ORPCError);
    expect(badRequestError.message).toBe("Invalid input");

    // Tagged error class is passed through
    const userNotFoundError = constructorMap.USER_NOT_FOUND_ERROR({
      data: { userId: "123" },
    });
    expect(isORPCTaggedError(userNotFoundError)).toBe(true);
    expect(userNotFoundError.code).toBe("USER_NOT_FOUND_ERROR");
    expect(userNotFoundError.data).toEqual({ userId: "123" });
  });
});

describe("effectErrorMapToErrorMap", () => {
  it("should convert EffectErrorMap to standard ErrorMap", () => {
    const effectErrorMap = {
      BAD_REQUEST: { status: 400, message: "Bad request" },
      USER_NOT_FOUND_ERROR: UserNotFoundError,
      FORBIDDEN: PermissionDenied,
    } satisfies EffectErrorMap;

    const errorMap = effectErrorMapToErrorMap(effectErrorMap);

    expect(errorMap.BAD_REQUEST).toEqual({
      status: 400,
      message: "Bad request",
    });
    expect(errorMap.USER_NOT_FOUND_ERROR).toEqual({
      data: userNotFoundSchema,
      message: "USER_NOT_FOUND_ERROR",
      status: 500,
    });
    expect(errorMap.FORBIDDEN).toEqual({
      data: undefined,
      message: fallbackORPCErrorMessage("FORBIDDEN", undefined),
      status: 403,
    });
  });
});

describe("effectBuilder with EffectErrorMap", () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  const effectOs = makeEffectORPC(runtime);

  it("should support errors() with traditional format", () => {
    const builder = effectOs.errors({
      BAD_REQUEST: { status: 400, message: "Bad request" },
    });

    expect(builder["~effect"].effectErrorMap).toEqual({
      BAD_REQUEST: { status: 400, message: "Bad request" },
    });
  });

  it("should support errors() with tagged error classes", () => {
    const builder = effectOs.errors({
      USER_NOT_FOUND_ERROR: UserNotFoundError,
      FORBIDDEN: PermissionDenied,
    });

    expect(builder["~effect"].effectErrorMap.USER_NOT_FOUND_ERROR).toBe(
      UserNotFoundError,
    );
    expect(builder["~effect"].effectErrorMap.FORBIDDEN).toBe(PermissionDenied);
  });

  it("should support mixed error format", () => {
    const builder = effectOs.errors({
      BAD_REQUEST: { status: 400 },
      USER_NOT_FOUND_ERROR: UserNotFoundError,
    });

    expect(builder["~effect"].effectErrorMap.BAD_REQUEST).toEqual({
      status: 400,
    });
    expect(builder["~effect"].effectErrorMap.USER_NOT_FOUND_ERROR).toBe(
      UserNotFoundError,
    );
  });

  it("should merge errors correctly", () => {
    const builder = effectOs
      .errors({ BAD_REQUEST: { status: 400 } })
      .errors({ USER_NOT_FOUND_ERROR: UserNotFoundError })
      .errors({ FORBIDDEN: PermissionDenied });

    expect(builder["~effect"].effectErrorMap).toEqual({
      BAD_REQUEST: { status: 400 },
      USER_NOT_FOUND_ERROR: UserNotFoundError,
      FORBIDDEN: PermissionDenied,
    });
  });

  it("should create procedure with effect handler", async () => {
    const procedure = effectOs
      .errors({
        USER_NOT_FOUND_ERROR: UserNotFoundError,
        BAD_REQUEST: { status: 400 },
      })
      .input(z.object({ id: z.string() }))
      .effect(function* ({ input, errors }) {
        // errors.USER_NOT_FOUND_ERROR is the class
        expect(errors.USER_NOT_FOUND_ERROR).toBe(UserNotFoundError);

        // errors.BAD_REQUEST is a factory function
        expect(typeof errors.BAD_REQUEST).toBe("function");

        return Effect.succeed({ id: input.id, name: "Test User" });
      });

    expect(procedure["~effect"].effectErrorMap.USER_NOT_FOUND_ERROR).toBe(
      UserNotFoundError,
    );
  });

  it("should allow throwing tagged errors in effect handler", async () => {
    const procedure = effectOs
      .errors({
        USER_NOT_FOUND_ERROR: UserNotFoundError,
      })
      .input(z.object({ id: z.string() }))
      .effect(function* ({ input, errors }) {
        if (input.id === "not-found") {
          return yield* Effect.fail(
            errors.USER_NOT_FOUND_ERROR({ data: { userId: "123" } }),
          );
        }
        return yield* Effect.succeed({ id: input.id, name: "Test User" });
      });

    // Test successful case
    const successResult = await procedure["~effect"].handler({
      context: {},
      input: { id: "123" },
      path: ["test"],
      procedure: {} as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {} as any,
    });
    expect(successResult).toEqual({ id: "123", name: "Test User" });

    // Test error case
    await expect(
      procedure["~effect"].handler({
        context: {},
        input: { id: "not-found" },
        path: ["test"],
        procedure: {} as any,
        signal: undefined,
        lastEventId: undefined,
        errors: {} as any,
      }),
    ).rejects.toThrow();
  });
});

describe("effectDecoratedProcedure.errors()", () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  const effectOs = makeEffectORPC(runtime);

  it("should support adding errors to procedure", () => {
    const procedure = effectOs
      .input(z.object({ id: z.string() }))
      .effect(function* ({ input }) {
        return { id: input.id };
      })
      .errors({ USER_NOT_FOUND_ERROR: UserNotFoundError });

    expect(procedure["~effect"].effectErrorMap.USER_NOT_FOUND_ERROR).toBe(
      UserNotFoundError,
    );
  });

  it("should merge errors on procedure", () => {
    const procedure = effectOs
      .errors({ BAD_REQUEST: { status: 400 } })
      .input(z.object({ id: z.string() }))
      .effect(function* ({ input }) {
        return { id: input.id };
      })
      .errors({ USER_NOT_FOUND_ERROR: UserNotFoundError });

    expect(procedure["~effect"].effectErrorMap).toEqual({
      BAD_REQUEST: { status: 400 },
      USER_NOT_FOUND_ERROR: UserNotFoundError,
    });
  });
});
