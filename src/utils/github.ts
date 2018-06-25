import * as OctokitRest from '@octokit/rest';

/**
 * Loads a file from the context's repository
 *
 * @param context Github context
 * @param path The path of the file in the repository
 * @param ref The string name of commit / branch / tag
 * @returns The decoded file contents
 * @async
 */
export async function getFile(
  octokit: OctokitRest,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const response = await octokit.repos.getContent({
      owner,
      path,
      ref,
      repo,
    });
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (err) {
    if (err.code === 404) {
      return undefined;
    }
    throw err;
  }
}
