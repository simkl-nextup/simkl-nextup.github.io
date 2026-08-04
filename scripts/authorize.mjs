import { APP_NAME, APP_VERSION } from "../src/constants.mjs";

const clientId = process.env.SIMKL_CLIENT_ID || process.argv[2];
if (!clientId) {
  console.error("Usage: npm run authorize -- YOUR_SIMKL_CLIENT_ID");
  process.exit(1);
}

const params = new URLSearchParams({
  client_id: clientId,
  "app-name": APP_NAME,
  "app-version": APP_VERSION,
});
const headers = { "User-Agent": `${APP_NAME}/${APP_VERSION}` };

async function requestJson(url) {
  const response = await fetch(url, { headers });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.message || result.error || `Simkl returned HTTP ${response.status}.`);
  }
  return result;
}

const pin = await requestJson(`https://api.simkl.com/oauth/pin?${params}`);
if (!pin.user_code || !pin.verification_uri) throw new Error("Simkl did not return a usable PIN.");

console.log(`\nOpen ${pin.verification_uri} and enter this PIN: ${pin.user_code}\n`);
const deadline = Date.now() + pin.expires_in * 1000;

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, pin.interval * 1000));
  const result = await requestJson(
    `https://api.simkl.com/oauth/pin/${encodeURIComponent(pin.user_code)}?${params}`,
  );

  if (result.access_token) {
    console.log("Authorization complete. Add this value as the GitHub repository secret SIMKL_ACCESS_TOKEN:\n");
    console.log(result.access_token);
    console.log("\nDo not commit or share this token.");
    process.exit(0);
  }
  if (result.result === "KO" && !/pending/i.test(result.message || "")) {
    throw new Error(result.message || "Simkl declined the PIN authorization.");
  }
}

console.error("The PIN expired before authorization completed. Run the command again.");
process.exit(1);
