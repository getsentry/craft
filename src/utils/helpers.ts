import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

import prompts from 'prompts';
import { logger, LogLevel, setLevel } from '../logger';

/**
 * Maximum size (in bytes) for step output values passed through GITHUB_OUTPUT.
 * Values exceeding this are truncated to avoid E2BIG errors when GitHub Actions
 * expands them into environment variables for subsequent steps.
 *
 * 64 KB is well under the ~2 MB ARG_MAX kernel limit and also under GitHub's
 * ~65 536-character issue body limit, so truncated changelogs still render.
 */
export const MAX_STEP_OUTPUT_BYTES = 64 * 1024;

const FALSY_ENV_VALUES = new Set(['', 'undefined', 'null', '0', 'false', 'no']);
export function envToBool(envVar: unknown): boolean {
  const normalized = String(envVar).toLowerCase();
  return !FALSY_ENV_VALUES.has(normalized);
}

export interface GlobalFlags {
  [flag: string]: unknown;
  'dry-run'?: boolean;
  'no-input'?: boolean;
  'log-level'?: keyof typeof LogLevel;
}

/** Internal type with required values (initialized with defaults) */
interface InternalGlobalFlags {
  'dry-run': boolean;
  'no-input': boolean;
  'log-level': keyof typeof LogLevel;
}

const GLOBAL_FLAGS: InternalGlobalFlags = {
  'dry-run': false,
  'no-input': false,
  'log-level': 'Info',
};

export function setGlobals(argv: GlobalFlags): void {
  if (argv['dry-run'] !== undefined) {
    GLOBAL_FLAGS['dry-run'] = argv['dry-run'];
  }
  if (argv['no-input'] !== undefined) {
    GLOBAL_FLAGS['no-input'] = argv['no-input'];
  }
  if (argv['log-level'] !== undefined) {
    GLOBAL_FLAGS['log-level'] = argv['log-level'];
  }
  logger.trace('Global flags:', GLOBAL_FLAGS);
  setLevel(LogLevel[GLOBAL_FLAGS['log-level']]);
  logger.trace('Argv: ', argv);
}

export function isDryRun(): boolean {
  return GLOBAL_FLAGS['dry-run'];
}

/**
 * Prompt the user that everything is OK and we should proceed
 */
export async function promptConfirmation(): Promise<void> {
  if (hasInput()) {
    const { isReady } = await prompts({
      message: 'Is everything OK? Type "yes" to proceed:',
      name: 'isReady',
      type: 'text',
      // Force the user to type something that is not empty or one letter such
      // as y/n to make sure this is a concious choice.
      validate: (input: string) =>
        input.length >= 2 || 'Please type "yes" to proceed',
    });
    if (isReady.toLowerCase() !== 'yes') {
      logger.error('Oh, okay. Aborting.');
      process.exit(1);
    }
  } else {
    logger.debug('Skipping the confirmation prompt.');
  }
}

export function hasInput(): boolean {
  return !GLOBAL_FLAGS['no-input'];
}

/**
 * Sets a GitHub Actions output variable.
 * Automatically uses heredoc-style delimiter syntax for multiline values.
 * No-op when not running in GitHub Actions.
 */
export function setGitHubActionsOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }

  if (value.includes('\n')) {
    // Use heredoc-style delimiter for multiline values
    const delimiter = `EOF_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    appendFileSync(
      outputFile,
      `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    );
  } else {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

/**
 * Writes a large value to a file under RUNNER_TEMP and sets a `{name}_file`
 * GitHub Actions output pointing to it.
 *
 * This avoids the Linux E2BIG error that occurs when a large step output is
 * expanded into an environment variable in a subsequent composite-action step.
 *
 * No-op when not running in GitHub Actions (RUNNER_TEMP is unset).
 *
 * @returns The absolute path of the written file, or `undefined` outside CI.
 */
export function writeGitHubActionsFile(
  name: string,
  content: string,
): string | undefined {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) {
    return undefined;
  }

  const dir = path.join(runnerTemp, 'craft');
  mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${name}.md`);
  writeFileSync(filePath, content, 'utf-8');
  setGitHubActionsOutput(`${name}_file`, filePath);

  return filePath;
}

/**
 * Truncates `value` to `MAX_STEP_OUTPUT_BYTES` (including the notice) and
 * appends a notice.
 *
 * When `changelogUrl` is provided the notice links to the full changelog on
 * GitHub (e.g. the CHANGELOG.md file on the release branch) so readers of the
 * truncated output in a publish issue can jump straight to the source.
 */
export function truncateForOutput(
  value: string,
  changelogUrl?: string,
): string {
  const notice = changelogUrl
    ? `\n\n---\n*Changelog truncated. [View full changelog](${changelogUrl}).*`
    : '\n\n---\n*Changelog truncated.*';

  const noticeBytes = Buffer.byteLength(notice, 'utf-8');
  const contentBudget = MAX_STEP_OUTPUT_BYTES - noticeBytes;

  if (Buffer.byteLength(value, 'utf-8') <= MAX_STEP_OUTPUT_BYTES) {
    return value;
  }

  // Truncate at a safe byte boundary by encoding then slicing
  let truncated = Buffer.from(value, 'utf-8')
    .subarray(0, contentBudget)
    .toString('utf-8');

  // Drop the last character only if the byte slice split a multi-byte
  // codepoint, which surfaces as the Unicode replacement character U+FFFD.
  if (truncated.length > 0 && truncated[truncated.length - 1] === '\uFFFD') {
    truncated = truncated.slice(0, -1);
  }

  return truncated + notice;
}

/**
 * Replaces `@author` mentions in changelog text with bold formatting
 * (`**author**`) to avoid pinging contributors when the changelog is
 * embedded in a GitHub issue body.
 *
 * Targets the exact output format of `formatChangelogEntry()`:
 * `- Title by @author in [#123](url)`
 */
export function disableChangelogMentions(changelog: string): string {
  return changelog.replace(/ by @(\S+) in /g, ' by **$1** in ');
}
