import assert from "node:assert/strict";

export const repository = "t00ls-dev/foundation";
export const shaPattern = /^[0-9a-f]{40}$/;

export async function authenticatedJson(
  url,
  token,
  fetcher = fetch,
  accept = "application/vnd.github+json",
) {
  assert(token, "Authentication token required");
  const response = await fetcher(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": accept,
      "User-Agent": "foundation-private-release",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  assert(
    response.ok && response.status === 200,
    `Authenticated request failed: ${response.status} ${url}`,
  );
  return response.json();
}
