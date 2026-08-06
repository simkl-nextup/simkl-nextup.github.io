import test from "node:test";
import assert from "node:assert/strict";
import {
  createPagesDeployment,
  dispatchPagesDeployment,
  requestActionsOidcToken,
} from "../scripts/dispatch-pages.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Pages dispatcher requests OIDC and queues exactly one deployment without polling", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return jsonResponse({ value: "signed-oidc-token" });
    if (calls.length === 2) {
      return jsonResponse({
        id: "deployment-123",
        page_url: "https://example.github.io/",
        status_url: "https://api.github.com/repos/example/site/pages/deployments/deployment-123",
      });
    }
    throw new Error("dispatcher polled after creating the deployment");
  };

  const result = await dispatchPagesDeployment({
    fetchImpl,
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/oidc",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
      GITHUB_API_URL: "https://api.github.com",
      GITHUB_REPOSITORY: "example/site",
      GITHUB_TOKEN: "github-token",
      PAGES_ARTIFACT_ID: "98765",
      PAGES_BUILD_VERSION: "sha-run-attempt",
      PAGES_ENVIRONMENT: "github-pages",
    },
  });

  assert.equal(result.deploymentId, "deployment-123");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer request-token");
  assert.equal(calls[1].url, "https://api.github.com/repos/example/site/pages/deployments");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.Authorization, "Bearer github-token");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    artifact_id: 98765,
    environment: "github-pages",
    pages_build_version: "sha-run-attempt",
    oidc_token: "signed-oidc-token",
  });
});

test("OIDC and Pages helpers surface API errors without exposing tokens", async () => {
  await assert.rejects(
    requestActionsOidcToken({
      requestUrl: "https://actions.example/oidc",
      requestToken: "secret-request-token",
      fetchImpl: async () => jsonResponse({ message: "forbidden" }, 403),
    }),
    /OIDC request failed with HTTP 403: forbidden/,
  );

  await assert.rejects(
    createPagesDeployment({
      repository: "example/site",
      artifactId: "not-an-id",
      buildVersion: "build",
      githubToken: "github-token",
      oidcToken: "oidc-token",
      fetchImpl: async () => {
        throw new Error("should not call fetch");
      },
    }),
    /positive integer/,
  );
});
