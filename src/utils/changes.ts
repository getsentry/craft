import { getVersion } from './version';

/**
 * Path to the changelog file in the target repository
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * A single changeset with name and description
 */
export interface Changeset {
  /** The name of this changeset */
  name: string;
  /** The markdown body describing the changeset */
  body: string;
}

/**
 * Extracts a specific changeset from a markdown document
 *
 * The changes are bounded by a header preceding the changes and an optional
 * header at the end. If the latter is omitted, the markdown document will be
 * read until its end. The title of the changes will be extracted from the
 * given header.
 *
 * @param markdown The full changelog markdown
 * @param header The header of the section to extract
 * @param nextHeader An optional header of the next section
 * @returns The extracted changes
 */
export function extractChangeset(
  markdown: string,
  header: RegExpExecArray,
  nextHeader?: RegExpExecArray
): Changeset {
  const start = header.index + header[0].length;
  const end = nextHeader ? nextHeader.index : undefined;
  const body = markdown.substring(start, end).trim();
  const name = (header[1] || header[2]).replace(/\(.*\)$/, '').trim();
  return { name, body };
}

/**
 * Searches for a changeset within the given markdown
 *
 * We support two formats at the moment:
 *    ## 1.2.3
 * and
 *    1.2.3
 *    -----
 *
 * @param markdown The markdown containing the changeset
 * @param tag A git tag containing a version number
 * @returns The changeset if found; otherwise null
 */
export function findChangeset(
  markdown: string,
  tag: string
): Changeset | undefined {
  const version = getVersion(tag);
  if (version === null) {
    return undefined;
  }

  const regex = /^ *## *([^\n]+?) *#* *(?:\n+|$)|^([^\n]+)\n *(?:-){2,} *(?:\n+|$)/gm;
  for (
    let match = regex.exec(markdown);
    match !== null;
    match = regex.exec(markdown)
  ) {
    if (getVersion(match[1] || match[2]) === version) {
      const nextMatch = regex.exec(markdown) || undefined;
      return extractChangeset(markdown, match, nextMatch);
    }
  }
  return undefined;
}
