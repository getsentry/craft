const REQUEST_TIMEOUT_MS = 30_000;

/** Credentials GitHub Actions exposes when the job has `id-token: write` */
interface GitHubOidcRequest {
  url: string;
  token: string;
}

/**
 * Returns the GitHub Actions OIDC request credentials, or undefined when the
 * job does not have the `id-token: write` permission (or isn't on Actions).
 */
export function getGitHubOidcRequest(): GitHubOidcRequest | undefined {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  return url && token ? { url, token } : undefined;
}

/**
 * Requests a GitHub Actions OIDC token for the given audience.
 *
 * @param request Credentials from {@link getGitHubOidcRequest}
 * @param audience The `aud` claim the receiving service checks
 */
export async function getGitHubOidcToken(
  request: GitHubOidcRequest,
  audience: string,
): Promise<string> {
  const url = new URL(request.url);
  url.searchParams.set('audience', audience);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${request.token}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub OIDC token request failed: HTTP ${response.status}`,
    );
  }
  const { value } = (await response.json()) as { value?: string };
  if (!value) {
    throw new Error('GitHub OIDC token response has no token');
  }
  return value;
}
