import { getVersion } from './version';

/**
 * Path to the changelog file in the target repository
 */
export const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';
export const DEFAULT_UNRELEASED_TITLE = 'Unreleased';
const HEADER_REGEX = /^ *## *([^\n]+?) *#* *(?:\n+|$)|^([^\n]+)\n *(?:-){2,} *(?:\n+|$)/gm;

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
 * A changeset location based on RegExpExecArrays
 */
export interface ChangesetLoc {
  start: RegExpExecArray;
  end: RegExpExecArray | null;
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
 * @param location The start & end location for the section
 * @returns The extracted changes
 */
export function extractChangeset(
  markdown: string,
  location: ChangesetLoc
): Changeset {
  const start = location.start.index + location.start[0].length;
  const end = location.end ? location.end.index : undefined;
  const body = markdown.substring(start, end).trim();
  const name = (location.start[1] || location.start[2])
    .replace(/\(.*\)$/, '')
    .trim();
  return { name, body };
}

/**
 * Does something
 * @param markdown The full changelog markdown
 * @param header The header of the section to extract
 */
export function locateChangeset(
  markdown: string,
  header: string,
  predicate: (match: string, expected: string) => boolean = (a, b) => a === b
): ChangesetLoc | undefined {
  HEADER_REGEX.lastIndex = 0;
  for (
    let match = HEADER_REGEX.exec(markdown);
    match !== null;
    match = HEADER_REGEX.exec(markdown)
  ) {
    const matchedTitle = match[1] || match[2];
    if (predicate(matchedTitle, header)) {
      return {
        end: HEADER_REGEX.exec(markdown),
        start: match,
      };
    }
  }
  return undefined;
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
 * @param [fallbackToUnreleased=false] Whether to fallback to "unreleased" when tag is not found
 * @returns The changeset if found; otherwise null
 */
export function findChangeset(
  markdown: string,
  tag: string,
  fallbackToUnreleased: boolean = false
): Changeset | undefined {
  const version = getVersion(tag);
  if (version === null) {
    return undefined;
  }

  let changesetLoc = locateChangeset(
    markdown,
    version,
    (match, header) => getVersion(match) === header
  );
  if (!changesetLoc && fallbackToUnreleased) {
    changesetLoc = locateChangeset(markdown, DEFAULT_UNRELEASED_TITLE);
  }

  return changesetLoc ? extractChangeset(markdown, changesetLoc) : undefined;
}

/**
 * Removes a given changeset from the provided markdown and returns the modified markdown
 * @param markdown The markdown containing the changeset
 * @param header The header of the changeset to-be-removed
 */
export function removeChangeset(markdown: string, header: string): string {
  const location = locateChangeset(markdown, header);
  if (!location) {
    return markdown;
  }

  const start = location.start.index;
  const end = location.end?.index ?? markdown.length;
  return markdown.slice(0, start) + markdown.slice(end);
}

/**
 * Prepends a changeset to the provided markdown text and returns the result
 * @param markdown The markdown that will be prepended
 * @param changeset The changeset data to prepend to
 */
export function prependChangeset(
  markdown: string,
  changeset: Changeset
): string {
  // Try to locate the top-most header, no matter what is inside
  const location = locateChangeset(markdown, '', () => true);
  const start = location?.start.index ?? 0;

  const newChangeset = `## ${changeset.name}\n\n${changeset.body || ''}\n\n`;

  return markdown.slice(0, start) + newChangeset + markdown.slice(start);
}
