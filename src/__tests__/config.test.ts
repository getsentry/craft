import { describe, test, expect } from 'vitest';
/**
 * Tests of our ability to read craft config files. (This is NOT general test
 * configuration).
 */

import { validateConfiguration } from '../config';
import { CraftProjectConfigSchema } from '../schemas/project_config';

describe('validateConfiguration', () => {
  test('parses minimal configuration', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with targets', () => {
    const data = {
      github: { owner: 'getsentry', repo: 'craft' },
      targets: [{ name: 'npm' }, { name: 'github', tagPrefix: 'v' }],
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with changelog object', () => {
    const data = {
      changelog: {
        filePath: 'CHANGELOG.md',
        policy: 'auto',
        scopeGrouping: true,
      },
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with changelog string', () => {
    const data = {
      changelog: 'CHANGELOG.md',
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with versioning', () => {
    const data = {
      versioning: {
        policy: 'calver',
        calver: {
          offset: 14,
          format: '%y.%-m',
        },
      },
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('fails with invalid github config', () => {
    expect(() =>
      validateConfiguration({ github: { owner: 'getsentry' } }),
    ).toThrow(/repo.*Required/);
  });

  test('fails with invalid minVersion format', () => {
    expect(() => validateConfiguration({ minVersion: 'invalid' })).toThrow(
      /minVersion/,
    );
  });

  test('fails with invalid changelog policy', () => {
    expect(() =>
      validateConfiguration({ changelog: { policy: 'invalid' } }),
    ).toThrow(/changelog/);
  });
});

describe('CraftProjectConfigSchema', () => {
  test('schema validates correct config', () => {
    const data = {
      github: { owner: 'getsentry', repo: 'craft' },
      minVersion: '2.14.0',
    };

    const result = CraftProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test('schema rejects invalid minVersion', () => {
    const data = {
      minVersion: 'not-a-version',
    };

    const result = CraftProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('noMerge config', () => {
  test('parses configuration with noMerge: true', () => {
    const data = { noMerge: true };
    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with noMerge: false', () => {
    const data = { noMerge: false };
    expect(validateConfiguration(data)).toEqual(data);
  });

  test('noMerge defaults to undefined when not specified', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };
    const result = validateConfiguration(data);
    expect(result.noMerge).toBeUndefined();
  });

  test('fails with invalid noMerge type', () => {
    expect(() => validateConfiguration({ noMerge: 'yes' })).toThrow(/noMerge/);
  });
});
