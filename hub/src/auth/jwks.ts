import { Hono } from "hono";
import { getPublicJwk } from "./jwt.js";

const jwksApp = new Hono();

jwksApp.get("/.well-known/jwks.json", (c) => {
  const jwk = getPublicJwk();

  return c.json({
    keys: [
      {
        ...jwk,
        alg: "EdDSA",
        use: "sig",
      },
    ],
  });
});

export { jwksApp };
