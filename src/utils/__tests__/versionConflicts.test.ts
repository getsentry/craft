import { describe, expect, test } from 'vitest';

import {
  resolveVersionBumpConflicts,
  resolveVersionBumpHunk,
} from '../versionConflicts';

const OURS = '<'.repeat(32);
const BASE = '|'.repeat(32);
const SEP = '='.repeat(32);
const THEIRS = '>'.repeat(32);

function conflict(ours: string, base: string, theirs: string): string {
  return `${OURS} ours\n${ours}${BASE} base\n${base}${SEP}\n${theirs}${THEIRS} theirs\n`;
}

describe('resolveVersionBumpHunk', () => {
  test('applies the version bump to the target branch side', () => {
    expect(
      resolveVersionBumpHunk(
        'version: 0.48.0-dev.0\ndescription: New description\n',
        'version: 0.48.0-dev.0\ndescription: Old description\n',
        'version: 0.48.0\ndescription: Old description\n',
        '0.48.0',
      ),
    ).toBe('version: 0.48.0\ndescription: New description\n');
  });

  test('bumps every occurrence of the old version in the hunk', () => {
    expect(
      resolveVersionBumpHunk(
        '"version": "1.1.0",\n"dependencies": { "core": "1.1.0", "x": "2" }\n',
        '"version": "1.1.0",\n"dependencies": { "core": "1.1.0" }\n',
        '"version": "1.2.0",\n"dependencies": { "core": "1.2.0" }\n',
        '1.2.0',
      ),
    ).toBe(
      '"version": "1.2.0",\n"dependencies": { "core": "1.2.0", "x": "2" }\n',
    );
  });

  test('handles PEP 440 style development versions', () => {
    expect(
      resolveVersionBumpHunk(
        'version = "2.1.0.dev0"\nrequires-python = ">=3.10"\n',
        'version = "2.1.0.dev0"\nrequires-python = ">=3.9"\n',
        'version = "2.1.0"\nrequires-python = ">=3.9"\n',
        '2.1.0',
      ),
    ).toBe('version = "2.1.0"\nrequires-python = ">=3.10"\n');
  });

  test('does not touch versions that only contain the old version', () => {
    expect(
      resolveVersionBumpHunk(
        'version: 1.0.0\nmin: 11.0.0\nnext: 1.0.0-rc.1\nnew line\n',
        'version: 1.0.0\nmin: 11.0.0\nnext: 1.0.0-rc.1\n',
        'version: 1.1.0\nmin: 11.0.0\nnext: 1.0.0-rc.1\n',
        '1.1.0',
      ),
    ).toBe('version: 1.1.0\nmin: 11.0.0\nnext: 1.0.0-rc.1\nnew line\n');
  });

  test('refuses when the release side changed more than versions', () => {
    expect(
      resolveVersionBumpHunk(
        'version: 1.0.0\ndescription: Target\n',
        'version: 1.0.0\ndescription: Base\n',
        'version: 1.1.0\ndescription: Hotfix\n',
        '1.1.0',
      ),
    ).toBeNull();
  });

  test('refuses when the release side added a line with the version', () => {
    expect(
      resolveVersionBumpHunk(
        '## Unreleased\n\n- Target change\n',
        '## Unreleased\n',
        '## 1.1.0\n\n- Release change\n',
        '1.1.0',
      ),
    ).toBeNull();
  });

  test('refuses when the release side bumped to another version', () => {
    expect(
      resolveVersionBumpHunk(
        'dep: 1.0.0\nother: x\n',
        'dep: 1.0.0\n',
        'dep: 3.0.0\n',
        '1.1.0',
      ),
    ).toBeNull();
  });

  test('refuses when the target branch changed the version itself', () => {
    expect(
      resolveVersionBumpHunk(
        'version: 2.0.0-dev.0\ndescription: Target\n',
        'version: 1.1.0-dev.0\ndescription: Base\n',
        'version: 1.1.0\ndescription: Base\n',
        '1.1.0',
      ),
    ).toBeNull();
  });
});

describe('resolveVersionBumpConflicts', () => {
  test('resolves every hunk and keeps the merged content around them', () => {
    const merged = [
      '---\n',
      'name: init\n',
      conflict(
        'version: 0.48.0-dev.0\ndescription: New\n',
        'version: 0.48.0-dev.0\ndescription: Old\n',
        'version: 0.48.0\ndescription: Old\n',
      ),
      'requires: sentry\n',
      '=======\n',
      conflict('v0.48.0-dev.0 (new)\n', 'v0.48.0-dev.0\n', 'v0.48.0\n'),
    ].join('');

    expect(resolveVersionBumpConflicts(merged, '0.48.0')).toBe(
      '---\nname: init\nversion: 0.48.0\ndescription: New\nrequires: sentry\n=======\nv0.48.0 (new)\n',
    );
  });

  test('refuses when any hunk is not a version bump', () => {
    const merged = [
      conflict(
        'version: 1.0.0\na\n',
        'version: 1.0.0\nb\n',
        'version: 1.1.0\nb\n',
      ),
      conflict('x\n', 'y\n', 'z\n'),
    ].join('');

    expect(resolveVersionBumpConflicts(merged, '1.1.0')).toBeNull();
  });

  test('refuses conflicts without a base section', () => {
    expect(
      resolveVersionBumpConflicts(
        `${OURS}\nversion: 1.0.0\n${SEP}\nversion: 1.1.0\n${THEIRS}\n`,
        '1.1.0',
      ),
    ).toBeNull();
  });

  test('refuses unterminated conflicts and content without conflicts', () => {
    expect(
      resolveVersionBumpConflicts(`${OURS}\na\n${BASE}\nb\n`, '1.1.0'),
    ).toBeNull();
    expect(resolveVersionBumpConflicts('no conflicts\n', '1.1.0')).toBeNull();
  });
});
