// errors.test.ts
//
// Tests for hub/src/lib/errors.ts — pure unit tests, no database or I/O.

import { describe, it, expect } from "bun:test";
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  RateLimitError,
} from "../../../src/lib/errors.js";

// ---------------------------------------------------------------------------
// AppError (base class)
// ---------------------------------------------------------------------------

describe("AppError — base class", () => {
  it("is an instance of Error", () => {
    // Act
    const err = new AppError(500, "INTERNAL_ERROR", "Something went wrong");

    // Assert
    expect(err instanceof Error).toBe(true);
  });

  it("carries the statusCode provided to the constructor", () => {
    // Act
    const err = new AppError(503, "SERVICE_UNAVAILABLE", "Unavailable");

    // Assert
    expect(err.statusCode).toBe(503);
  });

  it("carries the code provided to the constructor", () => {
    // Act
    const err = new AppError(503, "SERVICE_UNAVAILABLE", "Unavailable");

    // Assert
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("carries the message provided to the constructor", () => {
    // Act
    const err = new AppError(500, "INTERNAL_ERROR", "Custom message");

    // Assert
    expect(err.message).toBe("Custom message");
  });

  it("carries details when provided", () => {
    // Arrange
    const details = { field: "email", hint: "must be valid" };

    // Act
    const err = new AppError(400, "BAD_REQUEST", "Validation failed", details);

    // Assert
    expect(err.details).toEqual(details);
  });

  it("details is undefined when not provided", () => {
    // Act
    const err = new AppError(500, "INTERNAL_ERROR", "Oops");

    // Assert
    expect(err.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BadRequestError
// ---------------------------------------------------------------------------

describe("BadRequestError", () => {
  it("is an instance of AppError", () => {
    const err = new BadRequestError("Bad request");
    expect(err instanceof AppError).toBe(true);
  });

  it("is an instance of Error", () => {
    const err = new BadRequestError("Bad request");
    expect(err instanceof Error).toBe(true);
  });

  it("has statusCode 400", () => {
    // Act
    const err = new BadRequestError("Bad request");

    // Assert
    expect(err.statusCode).toBe(400);
  });

  it("has code 'BAD_REQUEST'", () => {
    // Act
    const err = new BadRequestError("Bad request");

    // Assert
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("uses the provided message", () => {
    // Act
    const err = new BadRequestError("Email is required");

    // Assert
    expect(err.message).toBe("Email is required");
  });

  it("accepts a details object", () => {
    // Arrange
    const details = { errors: [{ field: "email", message: "Email is required" }] };

    // Act
    const err = new BadRequestError("Validation failed", details);

    // Assert
    expect(err.details).toEqual(details);
  });

  it("details is undefined when not provided", () => {
    // Act
    const err = new BadRequestError("Bad request");

    // Assert
    expect(err.details).toBeUndefined();
  });

  it("name is 'BadRequestError'", () => {
    // Act
    const err = new BadRequestError("Bad request");

    // Assert
    expect(err.name).toBe("BadRequestError");
  });
});

// ---------------------------------------------------------------------------
// UnauthorizedError
// ---------------------------------------------------------------------------

describe("UnauthorizedError", () => {
  it("is an instance of AppError", () => {
    const err = new UnauthorizedError();
    expect(err instanceof AppError).toBe(true);
  });

  it("is an instance of Error", () => {
    const err = new UnauthorizedError();
    expect(err instanceof Error).toBe(true);
  });

  it("has statusCode 401", () => {
    // Act
    const err = new UnauthorizedError();

    // Assert
    expect(err.statusCode).toBe(401);
  });

  it("has code 'UNAUTHORIZED'", () => {
    // Act
    const err = new UnauthorizedError();

    // Assert
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("uses the default message 'Invalid credentials' when none is provided", () => {
    // Act
    const err = new UnauthorizedError();

    // Assert
    expect(err.message).toBe("Invalid credentials");
  });

  it("overrides the default message when a custom message is provided", () => {
    // Act
    const err = new UnauthorizedError("Token has expired");

    // Assert
    expect(err.message).toBe("Token has expired");
  });

  it("name is 'UnauthorizedError'", () => {
    // Act
    const err = new UnauthorizedError();

    // Assert
    expect(err.name).toBe("UnauthorizedError");
  });
});

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------

describe("NotFoundError", () => {
  it("is an instance of AppError", () => {
    const err = new NotFoundError();
    expect(err instanceof AppError).toBe(true);
  });

  it("is an instance of Error", () => {
    const err = new NotFoundError();
    expect(err instanceof Error).toBe(true);
  });

  it("has statusCode 404", () => {
    // Act
    const err = new NotFoundError();

    // Assert
    expect(err.statusCode).toBe(404);
  });

  it("has code 'NOT_FOUND'", () => {
    // Act
    const err = new NotFoundError();

    // Assert
    expect(err.code).toBe("NOT_FOUND");
  });

  it("uses the default message 'Resource not found' when none is provided", () => {
    // Act
    const err = new NotFoundError();

    // Assert
    expect(err.message).toBe("Resource not found");
  });

  it("overrides the default message when a custom message is provided", () => {
    // Act
    const err = new NotFoundError("User not found");

    // Assert
    expect(err.message).toBe("User not found");
  });

  it("name is 'NotFoundError'", () => {
    // Act
    const err = new NotFoundError();

    // Assert
    expect(err.name).toBe("NotFoundError");
  });
});

// ---------------------------------------------------------------------------
// ConflictError
// ---------------------------------------------------------------------------

describe("ConflictError", () => {
  it("is an instance of AppError", () => {
    const err = new ConflictError("Already exists");
    expect(err instanceof AppError).toBe(true);
  });

  it("is an instance of Error", () => {
    const err = new ConflictError("Already exists");
    expect(err instanceof Error).toBe(true);
  });

  it("has statusCode 409", () => {
    // Act
    const err = new ConflictError("Email already registered");

    // Assert
    expect(err.statusCode).toBe(409);
  });

  it("has code 'CONFLICT'", () => {
    // Act
    const err = new ConflictError("Email already registered");

    // Assert
    expect(err.code).toBe("CONFLICT");
  });

  it("uses the provided message", () => {
    // Act
    const err = new ConflictError("Email already registered");

    // Assert
    expect(err.message).toBe("Email already registered");
  });

  it("name is 'ConflictError'", () => {
    // Act
    const err = new ConflictError("Email already registered");

    // Assert
    expect(err.name).toBe("ConflictError");
  });
});

// ---------------------------------------------------------------------------
// RateLimitError
// ---------------------------------------------------------------------------

describe("RateLimitError", () => {
  it("is an instance of AppError", () => {
    const err = new RateLimitError();
    expect(err instanceof AppError).toBe(true);
  });

  it("is an instance of Error", () => {
    const err = new RateLimitError();
    expect(err instanceof Error).toBe(true);
  });

  it("has statusCode 429", () => {
    // Act
    const err = new RateLimitError();

    // Assert
    expect(err.statusCode).toBe(429);
  });

  it("has code 'RATE_LIMIT_EXCEEDED'", () => {
    // Act
    const err = new RateLimitError();

    // Assert
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("uses the default message 'Too many requests' when none is provided", () => {
    // Act
    const err = new RateLimitError();

    // Assert
    expect(err.message).toBe("Too many requests");
  });

  it("overrides the default message when a custom message is provided", () => {
    // Act
    const err = new RateLimitError("Rate limit exceeded — try again in 60 seconds");

    // Assert
    expect(err.message).toBe("Rate limit exceeded — try again in 60 seconds");
  });

  it("name is 'RateLimitError'", () => {
    // Act
    const err = new RateLimitError();

    // Assert
    expect(err.name).toBe("RateLimitError");
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting — all subclasses are instances of AppError and Error
// ---------------------------------------------------------------------------

describe("all AppError subclasses", () => {
  // Build a small table of [name, constructor, args] for table-driven checks.
  const cases: Array<[string, () => AppError]> = [
    ["BadRequestError", () => new BadRequestError("msg")],
    ["UnauthorizedError", () => new UnauthorizedError()],
    ["NotFoundError", () => new NotFoundError()],
    ["ConflictError", () => new ConflictError("msg")],
    ["RateLimitError", () => new RateLimitError()],
  ];

  for (const [label, factory] of cases) {
    it(`${label} is an instance of AppError`, () => {
      expect(factory() instanceof AppError).toBe(true);
    });

    it(`${label} is an instance of Error`, () => {
      expect(factory() instanceof Error).toBe(true);
    });

    it(`${label} has a non-empty message`, () => {
      expect(factory().message.length).toBeGreaterThan(0);
    });

    it(`${label} has a numeric statusCode`, () => {
      expect(typeof factory().statusCode).toBe("number");
    });

    it(`${label} has a non-empty string code`, () => {
      const code = factory().code;
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  }
});
