import { ORPCError } from "@orpc/client";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import z from "zod";

import {
  isORPCTaggedError,
  ORPCErrorSymbol,
  ORPCTaggedError,
  type TagToCode,
  toORPCError,
} from "../tagged-error";

// Define test errors with explicit code
class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
  code: "NOT_FOUND",
}) {}

class ValidationError extends ORPCTaggedError("ValidationError", {
  schema: z.object({ fields: z.array(z.string()) }),
  code: "BAD_REQUEST",
  message: "Validation failed",
}) {}

class CustomStatusError extends ORPCTaggedError("CustomStatusError", {
  code: "INTERNAL_SERVER_ERROR",
  status: 503,
  message: "Service unavailable",
}) {}

// Define test errors with default code (derived from tag)
class AutoCodeError extends ORPCTaggedError("AutoCodeError", {
  code: "AUTO_CODE_ERROR",
}) {}

class AutoCodeWithOptionsError extends ORPCTaggedError(
  "AutoCodeWithOptionsError",
  { message: "Auto code error message" },
) {}

class MyCustomError extends ORPCTaggedError("MyCustomError", {
  code: "MY_CUSTOM_ERROR",
}) {}

describe("class ORPCTaggedError", () => {
  describe("basic functionality", () => {
    it("should create an error with the correct tag", () => {
      const error = new UserNotFoundError();

      expect(error._tag).toBe("UserNotFoundError");
      expect(error.name).toBe("UserNotFoundError");
    });

    it("should create an error with the correct code", () => {
      const error = new UserNotFoundError();

      expect(error.code).toBe("NOT_FOUND");
    });

    it("should use default status from code", () => {
      const error = new UserNotFoundError();

      expect(error.status).toBe(404);
    });

    it("should use default message from code", () => {
      const error = new UserNotFoundError();

      expect(error.message).toBe("Not Found");
    });

    it("should be defined by default", () => {
      const error = new UserNotFoundError();

      expect(error.defined).toBe(true);
    });

    it("should allow custom message", () => {
      const error = new UserNotFoundError({
        message: "User with ID 123 not found",
      });

      expect(error.message).toBe("User with ID 123 not found");
    });

    it("should use default message from options", () => {
      const error = new ValidationError({ data: { fields: ["email"] } });

      expect(error.message).toBe("Validation failed");
    });

    it("should use default status from options", () => {
      const error = new CustomStatusError();

      expect(error.status).toBe(503);
    });

    it("should allow custom status override", () => {
      // Custom status that's still a valid error status
      const error = new UserNotFoundError({ status: 410 });

      expect(error.status).toBe(410);
    });

    it("should throw on invalid status", () => {
      expect(() => new UserNotFoundError({ status: 200 })).toThrow(
        "[ORPCTaggedError] Invalid error status code.",
      );
    });
  });

  describe("data handling", () => {
    it("should handle data correctly", () => {
      const error = new ValidationError({
        data: { fields: ["email", "password"] },
      });

      expect(error.data).toEqual({ fields: ["email", "password"] });
    });

    it("should handle undefined data", () => {
      const error = new UserNotFoundError();

      expect(error.data).toBeUndefined();
    });
  });

  describe("interop with ORPCError", () => {
    it("should have ORPCErrorSymbol", () => {
      const error = new UserNotFoundError();

      expect(ORPCErrorSymbol in error).toBe(true);
      expect(error[ORPCErrorSymbol]).toBeInstanceOf(ORPCError);
    });

    it("should create equivalent ORPCError via toORPCError method", () => {
      const error = new UserNotFoundError({ message: "Custom message" });
      const orpcError = error.toORPCError();

      expect(orpcError).toBeInstanceOf(ORPCError);
      expect(orpcError.code).toBe("NOT_FOUND");
      expect(orpcError.status).toBe(404);
      expect(orpcError.message).toBe("Custom message");
      expect(orpcError.defined).toBe(true);
    });

    it("should create equivalent ORPCError via toORPCError function", () => {
      const error = new ValidationError({ data: { fields: ["name"] } });
      const orpcError = toORPCError(error);

      expect(orpcError).toBeInstanceOf(ORPCError);
      expect(orpcError.code).toBe("BAD_REQUEST");
      expect(orpcError.data).toEqual({ fields: ["name"] });
    });
  });

  describe("isORPCTaggedError", () => {
    it("should return true for ORPCTaggedError instances", () => {
      const error = new UserNotFoundError();

      expect(isORPCTaggedError(error)).toBe(true);
    });

    it("should return false for regular ORPCError", () => {
      const error = new ORPCError("NOT_FOUND");

      expect(isORPCTaggedError(error)).toBe(false);
    });

    it("should return false for regular Error", () => {
      const error = new Error("test");

      expect(isORPCTaggedError(error)).toBe(false);
    });

    it("should return false for non-objects", () => {
      expect(isORPCTaggedError(null)).toBe(false);
      expect(isORPCTaggedError(undefined)).toBe(false);
      expect(isORPCTaggedError("string")).toBe(false);
      expect(isORPCTaggedError(123)).toBe(false);
    });
  });

  describe("toJSON", () => {
    it("should serialize to JSON with all fields", () => {
      const error = new ValidationError({
        data: { fields: ["email"] },
        message: "Invalid input",
      });

      expect(error.toJSON()).toEqual({
        _tag: "ValidationError",
        defined: true,
        code: "BAD_REQUEST",
        status: 400,
        message: "Invalid input",
        data: { fields: ["email"] },
      });
    });
  });

  describe("effect integration", () => {
    it("should work with Effect.fail", async () => {
      const program = Effect.fail(
        new ValidationError({ data: { fields: ["email"] } }),
      );

      const result = await Effect.runPromiseExit(program);

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failReason = result.cause.reasons.find(Cause.isFailReason);
        const error = failReason ? failReason.error : null;
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).data).toEqual({ fields: ["email"] });
      }
    });

    it("should work with Effect.catchTag using Effect.fail", async () => {
      const program = Effect.fail(new UserNotFoundError()).pipe(
        Effect.catchTag("UserNotFoundError", () => Effect.succeed("recovered")),
      );

      const result = await Effect.runPromise(program);

      expect(result).toBe("recovered");
    });

    it("should preserve type information in catchTag", async () => {
      const program = Effect.fail(
        new ValidationError({ data: { fields: ["email"] } }),
      ).pipe(
        Effect.catchTag("ValidationError", (e) => {
          // e should be typed as ValidationError
          return Effect.succeed(`Fields: ${e.data.fields.join(", ")}`);
        }),
      );

      const result = await Effect.runPromise(program);

      expect(result).toBe("Fields: email");
    });
  });

  describe("class static properties", () => {
    it("should have static _tag", () => {
      expect(UserNotFoundError._tag).toBe("UserNotFoundError");
    });

    it("should have static code", () => {
      expect(UserNotFoundError.code).toBe("NOT_FOUND");
    });
  });

  describe("error cause", () => {
    it("should propagate cause to underlying error", () => {
      const originalError = new Error("Original error");
      const error = new UserNotFoundError({ cause: originalError });

      expect(error.cause).toBe(originalError);
      expect(error.toORPCError().cause).toBe(originalError);
    });
  });

  describe("automatic code from tag", () => {
    it("should derive code from tag in CONSTANT_CASE", () => {
      const error = new AutoCodeError();

      expect(error.code).toBe("AUTO_CODE_ERROR");
      expect(error._tag).toBe("AutoCodeError");
    });

    it("should derive code correctly for various PascalCase names", () => {
      const error = new MyCustomError();

      expect(error.code).toBe("MY_CUSTOM_ERROR");
    });

    it("should work with options but no explicit code", () => {
      const error = new AutoCodeWithOptionsError();

      expect(error.code).toBe("AUTO_CODE_WITH_OPTIONS_ERROR");
      expect(error.message).toBe("Auto code error message");
    });

    it("should have correct static code", () => {
      expect(AutoCodeError.code).toBe("AUTO_CODE_ERROR");
      expect(MyCustomError.code).toBe("MY_CUSTOM_ERROR");
      expect(AutoCodeWithOptionsError.code).toBe(
        "AUTO_CODE_WITH_OPTIONS_ERROR",
      );
    });

    it("should use custom status of 500 for unknown codes", () => {
      const error = new AutoCodeError();

      // Unknown codes default to 500
      expect(error.status).toBe(500);
    });

    describe("TagToCode edge cases", () => {
      describe("runtime behavior", () => {
        it("should keep consecutive uppercase letters together", () => {
          class TESTError extends ORPCTaggedError("TEST") {}
          expect(TESTError.code).toBe("TEST");
        });

        it("should handle single word tags", () => {
          class TestError extends ORPCTaggedError("Test") {}
          expect(TestError.code).toBe("TEST");
        });

        it("should split between words correctly", () => {
          class TestTestError extends ORPCTaggedError("TestTest") {}
          expect(TestTestError.code).toBe("TEST_TEST");
        });

        it("should handle tags with single uppercase followed by lowercase", () => {
          class UnauthorizedError extends ORPCTaggedError(
            "UnauthorizedError",
          ) {}
          expect(UnauthorizedError.code).toBe("UNAUTHORIZED_ERROR");
        });

        it("should handle mixed case patterns", () => {
          class HTTPError extends ORPCTaggedError("HTTPError") {}
          expect(HTTPError.code).toBe("HTTP_ERROR");

          class XMLParserError extends ORPCTaggedError("XMLParserError") {}
          expect(XMLParserError.code).toBe("XML_PARSER_ERROR");
        });
      });

      describe("type-level behavior", () => {
        it("should correctly type consecutive uppercase letters", () => {
          expectTypeOf<TagToCode<"TEST">>().toEqualTypeOf<"TEST">();
        });

        it("should correctly type single word tags", () => {
          expectTypeOf<TagToCode<"Test">>().toEqualTypeOf<"TEST">();
        });

        it("should correctly type word splitting", () => {
          expectTypeOf<TagToCode<"TestTest">>().toEqualTypeOf<"TEST_TEST">();
        });

        it("should correctly type single uppercase followed by lowercase", () => {
          expectTypeOf<
            TagToCode<"UnauthorizedError">
          >().toEqualTypeOf<"UNAUTHORIZED_ERROR">();
        });

        it("should correctly type mixed case patterns", () => {
          expectTypeOf<TagToCode<"HTTPError">>().toEqualTypeOf<"HTTP_ERROR">();
          expectTypeOf<
            TagToCode<"XMLParserError">
          >().toEqualTypeOf<"XML_PARSER_ERROR">();
        });

        it("should correctly type complex patterns", () => {
          expectTypeOf<
            TagToCode<"UserNotFoundError">
          >().toEqualTypeOf<"USER_NOT_FOUND_ERROR">();
          expectTypeOf<
            TagToCode<"AutoCodeError">
          >().toEqualTypeOf<"AUTO_CODE_ERROR">();
          expectTypeOf<
            TagToCode<"MyCustomError">
          >().toEqualTypeOf<"MY_CUSTOM_ERROR">();
        });
      });
    });
  });
});
