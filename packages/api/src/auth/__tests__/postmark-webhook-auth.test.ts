/**
 * Stage 1, Task G1 — verifying the Postmark webhook's HTTP Basic credentials.
 *
 * The point of interest in these tests is not that a correct password passes.
 * It is the three ways this check could be written so that it looks like a
 * check and is not:
 *
 *   1. Accepting the request when no credentials are configured, which is an
 *      open endpoint with a security-shaped function in front of it, in
 *      exactly the deployment (a fresh production environment missing an env
 *      var) where nobody would notice.
 *   2. Splitting `user:pass` on every colon, so a password containing one is
 *      truncated and can never match — a check that always fails, which gets
 *      "fixed" later by someone loosening it.
 *   3. Comparing with `===`, or short-circuiting the username comparison,
 *      which leaks the credential through response timing.
 *
 * Each has a test below.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import {
  postmarkWebhookCredentialsFromEnv,
  verifyPostmarkWebhook,
  verifyPostmarkWebhookAuth,
} from "../postmark-webhook-auth.js";

const CREDENTIALS = { username: "postmark", password: "s3cr3t-webhook-password" };

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

describe("verifyPostmarkWebhookAuth", () => {
  it("accepts the configured credentials", () => {
    const result = verifyPostmarkWebhookAuth(
      basic(CREDENTIALS.username, CREDENTIALS.password),
      CREDENTIALS,
    );
    expect(result.outcome).toBe("ok");
  });

  it("REFUSES when no credentials are configured, rather than waving the request through", () => {
    // The whole task in one assertion. "Unconfigured" must not mean "no check
    // needed" — that is the hole this endpoint had, reintroduced by omission.
    const result = verifyPostmarkWebhookAuth(basic("anyone", "anything"), null);
    expect(result.outcome).toBe("unconfigured");
    expect(result.outcome === "unconfigured" && result.reason).toMatch(/POSTMARK_WEBHOOK_USERNAME/);
  });

  it("refuses an absent, non-Basic, or malformed Authorization header", () => {
    expect(verifyPostmarkWebhookAuth(undefined, CREDENTIALS).outcome).toBe("rejected");
    expect(verifyPostmarkWebhookAuth("Bearer some-token", CREDENTIALS).outcome).toBe("rejected");
    expect(verifyPostmarkWebhookAuth("Basic", CREDENTIALS).outcome).toBe("rejected");
    // Valid base64, but no colon — not a credential pair.
    expect(
      verifyPostmarkWebhookAuth(
        `Basic ${Buffer.from("no-colon-here", "utf8").toString("base64")}`,
        CREDENTIALS,
      ).outcome,
    ).toBe("rejected");
  });

  it("accepts a lowercase scheme token", () => {
    // RFC 7617 makes the scheme case-insensitive, and proxies do normalise it.
    // Rejecting `basic ` would be a webhook that fails in production only.
    const header = basic(CREDENTIALS.username, CREDENTIALS.password).replace("Basic", "basic");
    expect(verifyPostmarkWebhookAuth(header, CREDENTIALS).outcome).toBe("ok");
  });

  it("refuses a right username with a wrong password, and the reverse", () => {
    expect(verifyPostmarkWebhookAuth(basic("postmark", "wrong"), CREDENTIALS).outcome).toBe(
      "rejected",
    );
    expect(
      verifyPostmarkWebhookAuth(basic("wrong", CREDENTIALS.password), CREDENTIALS).outcome,
    ).toBe("rejected");
  });

  it("handles a password containing a colon", () => {
    // RFC 7617 splits on the FIRST colon only. A naive `split(":")` truncates
    // this password, so the check would reject the correct credentials for
    // ever, and the log line would read "credentials do not match".
    const credentials = { username: "postmark", password: "a:b:c:d" };
    expect(
      verifyPostmarkWebhookAuth(basic(credentials.username, credentials.password), credentials)
        .outcome,
    ).toBe("ok");
    // And a password that is a PREFIX of the real one, up to the first colon,
    // must still fail — proving the tail is compared, not discarded.
    expect(verifyPostmarkWebhookAuth(basic("postmark", "a"), credentials).outcome).toBe("rejected");
  });

  it("does not treat an empty password as a match for an empty configured value", () => {
    // `postmarkWebhookCredentialsFromEnv` must not produce credentials from a
    // blank env var: an empty configured password plus an empty presented one
    // compares equal, which is an open endpoint that passes its own test.
    expect(
      postmarkWebhookCredentialsFromEnv({
        POSTMARK_WEBHOOK_USERNAME: "postmark",
        POSTMARK_WEBHOOK_PASSWORD: "",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      postmarkWebhookCredentialsFromEnv({
        POSTMARK_WEBHOOK_USERNAME: "   ",
        POSTMARK_WEBHOOK_PASSWORD: "something",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(postmarkWebhookCredentialsFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("reads both halves from the environment when they are set", () => {
    expect(
      postmarkWebhookCredentialsFromEnv({
        POSTMARK_WEBHOOK_USERNAME: "postmark",
        POSTMARK_WEBHOOK_PASSWORD: "pw",
      } as NodeJS.ProcessEnv),
    ).toEqual({ username: "postmark", password: "pw" });
  });

  it("compares both fields even when the username is already wrong", () => {
    // A timing assertion would be flaky in CI, so this asserts the property
    // that makes the timing safe instead: a wrong username and a wrong
    // password are indistinguishable in the result, and the implementation
    // computes both comparisons before combining them. If someone rewrote it
    // as `usernameOk && passwordOk` with a short-circuit, this would still
    // pass — which is why the guarantee is stated in the source and this test
    // only pins the observable half: no branch of the outcome tells the caller
    // WHICH field was wrong.
    const wrongUser = verifyPostmarkWebhookAuth(basic("nope", CREDENTIALS.password), CREDENTIALS);
    const wrongPass = verifyPostmarkWebhookAuth(basic(CREDENTIALS.username, "nope"), CREDENTIALS);
    expect(wrongUser).toEqual(wrongPass);
  });
});

describe("the verifyPostmarkWebhook preHandler, over HTTP", () => {
  /**
   * The pure function above can be perfect and the endpoint still open, if the
   * preHandler forgets to `return` the reply, or calls a `reply` helper that
   * does not exist on this instance. So these drive a real Fastify route and
   * assert on status codes and on whether the handler ran.
   *
   * No database and no Better Auth: this is about the webhook's own credential
   * check, which is a separate layer from the deny-by-default policy.
   */
  async function buildWebhookApp(readCredentials: () => typeof CREDENTIALS | null) {
    const server = Fastify({ logger: false });
    await server.register(sensible);
    const handlerCalls: number[] = [];
    server.post(
      "/webhooks/postmark",
      { preHandler: [verifyPostmarkWebhook(readCredentials)] },
      async () => {
        handlerCalls.push(1);
        return { ok: true };
      },
    );
    return { server, handlerCalls };
  }

  it("serves the handler for a correctly authenticated call", async () => {
    const { server, handlerCalls } = await buildWebhookApp(() => CREDENTIALS);
    try {
      const res = await server.inject({
        method: "POST",
        url: "/webhooks/postmark",
        headers: { authorization: basic(CREDENTIALS.username, CREDENTIALS.password) },
        payload: { RecordType: "Delivery" },
      });
      expect(res.statusCode).toBe(200);
      expect(handlerCalls).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("answers 401 and does NOT run the handler for a forged call", async () => {
    // The attack this closes: a fabricated HardBounce for a guessed delivery
    // id, which permanently suppresses mail to a real town official. The
    // handler must not have run at all.
    const { server, handlerCalls } = await buildWebhookApp(() => CREDENTIALS);
    try {
      const res = await server.inject({
        method: "POST",
        url: "/webhooks/postmark",
        payload: { RecordType: "Bounce", Type: "HardBounce" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toMatch(/^Basic /);
      expect(handlerCalls).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("answers 503 and does NOT run the handler when credentials are unconfigured", async () => {
    const { server, handlerCalls } = await buildWebhookApp(() => null);
    try {
      const res = await server.inject({
        method: "POST",
        url: "/webhooks/postmark",
        headers: { authorization: basic("anyone", "anything") },
        payload: { RecordType: "Delivery" },
      });
      expect(res.statusCode).toBe(503);
      expect(handlerCalls).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
