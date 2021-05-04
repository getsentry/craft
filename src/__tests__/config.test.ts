/**
 * Tests of our ability to read craft config files. (This is NOT general test
 * configuration).
 */

import simpleGit from 'simple-git';
import fs from 'fs';
import { dirname, join } from 'path';

import { compile } from 'json-schema-to-typescript';

jest.mock('simple-git');

import {
  getGlobalGithubConfig,
  getProjectConfigSchema,
  validateConfiguration,
} from '../config';

const configSchemaDir = join(dirname(__dirname), 'schemas');
const configGeneratedTypes = join(configSchemaDir, 'project_config.ts');

/**
 * We compile JSON schema to TypeScript interface as part of tests to compare
 * it with the existing file. This is done to be promptly notified about any
 * changes to the JSON schema that are not yet reflected in the TS interface.
 */
describe('compile-json-schema-to-typescript', () => {
  test('does not make any changes to the compiled interface', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const projectConfig = require('../schemas/projectConfig.schema');
    const storedOutput = fs.readFileSync(configGeneratedTypes, {
      encoding: 'utf8',
    });
    const compileOptions = {
      style: { singleQuote: true, trailingComma: 'es5' } as any,
    };
    const generatedOutput = await compile(projectConfig, '', compileOptions);

    expect(generatedOutput).toBeTruthy();
    expect(generatedOutput).toBe(storedOutput);
  });
});

describe('validateConfiguration', () => {
  test('parses minimal configuration', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('fails with bad configuration', () => {
    expect(() => validateConfiguration({ zoom: 1 }))
      .toThrowErrorMatchingInlineSnapshot(`
      "Cannot parse configuration file:
      data should NOT have additional properties"
    `);
  });
});

describe('getProjectConfigSchema', () => {
  test('returns non-empty object', () => {
    const projectConfigSchema = getProjectConfigSchema();

    expect(projectConfigSchema).toHaveProperty('title');
    expect(projectConfigSchema).toHaveProperty('properties');
  });
});

describe('getGlobalGithubConfig', () => {
  const mockReadFileSync: jest.MockedFunction<
    typeof fs.readFileSync
  > = jest.fn();
  const mockGetRemotes = jest.fn();
  beforeAll(() => {
    fs.readFileSync = mockReadFileSync;
    // @ts-ignore: We know only getRemotes will be called, anything else should fail
    (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      getRemotes: mockGetRemotes,
    });
  });

  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockGetRemotes.mockReset();
  });

  test('returns configured values when set in configuration', async () => {
    const githubRepo = { owner: 'getsentry', repo: 'yolo' };
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ github: githubRepo })
    );
    expect(await getGlobalGithubConfig(true)).toEqual(githubRepo);
  });

  test('automatically uses git origin URL when config is not set', async () => {
    mockReadFileSync.mockReturnValueOnce('{}');
    mockGetRemotes.mockReturnValueOnce([
      { name: 'origin', refs: { push: 'git@github.com:getsentry/yolo.git' } },
    ]);

    expect(await getGlobalGithubConfig(true)).toEqual({
      owner: 'getsentry',
      repo: 'yolo',
    });
  });

  test('throws error when no config and no git', async () => {
    mockReadFileSync.mockReturnValueOnce('{}');
    mockGetRemotes.mockReturnValueOnce([]);

    await expect(getGlobalGithubConfig(true)).rejects.toThrow(
      'GitHub configuration not found in the config file and cannot be determined from Git'
    );
  });
});
