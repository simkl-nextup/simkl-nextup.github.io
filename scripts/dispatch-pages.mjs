import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText || "request failed";
    throw new Error(`${label} failed with HTTP ${response.status}: ${message}`);
  }
  return body;
}

export async function requestActionsOidcToken({
  requestUrl,
  requestToken,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(
    required(requestUrl, "ACTIONS_ID_TOKEN_REQUEST_URL"),
    {
      headers: {
        Authorization: `Bearer ${required(requestToken, "ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
        Accept: "application/json",
      },
    },
  );
  const body = await readJson(response, "GitHub Actions OIDC request");
  return required(body?.value, "OIDC token response value");
}

export async function createPagesDeployment({
  repository,
  artifactId,
  buildVersion,
  githubToken,
  oidcToken,
  apiUrl = "https://api.github.com",
  environment = "github-pages",
  fetchImpl = fetch,
} = {}) {
  const numericArtifactId = Number(artifactId);
  if (!Number.isSafeInteger(numericArtifactId) || numericArtifactId <= 0) {
    throw new Error(`PAGES_ARTIFACT_ID must be a positive integer; received ${artifactId}.`);
  }

  const response = await fetchImpl(
    `${required(apiUrl, "GITHUB_API_URL").replace(/\/$/, "")}/repos/${required(repository, "GITHUB_REPOSITORY")}/pages/deployments`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${required(githubToken, "GITHUB_TOKEN")}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({
        artifact_id: numericArtifactId,
        environment,
        pages_build_version: required(buildVersion, "PAGES_BUILD_VERSION"),
        oidc_token: required(oidcToken, "OIDC token"),
      }),
    },
  );
  return readJson(response, "GitHub Pages deployment request");
}

export async function dispatchPagesDeployment({ env = process.env, fetchImpl = fetch } = {}) {
  const oidcToken = await requestActionsOidcToken({
    requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    fetchImpl,
  });

  const deployment = await createPagesDeployment({
    repository: env.GITHUB_REPOSITORY,
    artifactId: env.PAGES_ARTIFACT_ID,
    buildVersion: env.PAGES_BUILD_VERSION,
    githubToken: env.GITHUB_TOKEN,
    oidcToken,
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    environment: env.PAGES_ENVIRONMENT || "github-pages",
    fetchImpl,
  });

  const deploymentId = deployment?.id
    || deployment?.status_url?.split("/").filter(Boolean).at(-1)
    || env.PAGES_BUILD_VERSION;
  const pageUrl = deployment?.page_url || "";

  console.log(`Queued GitHub Pages deployment ${deploymentId}.`);
  console.log("The verified artifact is now owned by GitHub Pages; this workflow will not poll the queue.");

  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `deployment_id=${deploymentId}\npage_url=${pageUrl}\n`, "utf8");
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `## GitHub Pages deployment queued\n\n- Deployment: \`${deploymentId}\`\n- Artifact: \`${env.PAGES_ARTIFACT_ID}\`\n- The workflow exits after GitHub accepts the deployment; publishing continues in GitHub Pages.\n`,
      "utf8",
    );
  }
  return { deploymentId, pageUrl, deployment };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dispatchPagesDeployment().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
