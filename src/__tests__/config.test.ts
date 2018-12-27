import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { compile } from 'json-schema-to-typescript';

import {
  getProjectConfigSchema,
  readEnvironmentConfig,
  validateConfiguration,
} from '../config';
import { withTempDir } from '../utils/files';

jest.mock('os');

const configSchemaDir = join(dirname(__dirname), 'schemas');
const configGeneratedTypes = join(configSchemaDir, 'project_config.ts');

/**
 * We compile JSON schema to TypeScript interface as part of tests to compare
 * it with the existing file. This is done to be promptly notified about any
 * changes to the JSON schema that are not yet reflected in the TS interface.
 */
describe('compile-json-schema-to-typescript', () => {
  test('does not make any changes to the compiled interface', async () => {
    const projectConfig = require('../schemas/projectConfig.schema');
    const storedOutput = readFileSync(configGeneratedTypes, {
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
  test('parses minimal configuration', async () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    const projectConfig = validateConfiguration(data);

    expect(projectConfig).toEqual(data);
  });

  test('fails with empty configuration', async () => {
    expect.assertions(1);

    try {
      validateConfiguration({});
    } catch (e) {
      expect(e.message).toMatch(/should have required property/i);
    }
  });
});

describe('getProjectConfigSchema', () => {
  test('returns non-empty object', async () => {
    const projectConfigSchema = getProjectConfigSchema();

    expect(projectConfigSchema).toBeTruthy();
    expect(projectConfigSchema).toHaveProperty('title');
    expect(projectConfigSchema).toHaveProperty('properties');
  });
});

describe('readEnvironmentConfig', () => {
  const homedirMock = (os.homedir = jest.fn());
  const cwdMock = (process.cwd = jest.fn());

  const invalidDir = '/invalid/invalid';

  beforeEach(() => {
    delete process.env.TEST_BLA;
    jest.clearAllMocks();
  });
  test('calls homedir/process.cwd', async () => {
    process.env.TEST_BLA = '123';

    homedirMock.mockReturnValue(invalidDir);
    cwdMock.mockReturnValue(invalidDir);

    readEnvironmentConfig();

    expect(cwdMock).toHaveBeenCalledTimes(1);
    expect(homedirMock).toHaveBeenCalledTimes(1);
    expect(process.env.TEST_BLA).toBe('123');
  });

  test('checks current directory', async () => {
    homedirMock.mockReturnValue(invalidDir);
    process.env.TEST_BLA = '123';

    await withTempDir(async directory => {
      cwdMock.mockReturnValue(directory);
      const outFile = join(directory, '.craft.env');
      writeFileSync(outFile, 'export TEST_BLA=234');

      readEnvironmentConfig();

      expect(cwdMock).toHaveBeenCalledTimes(1);
      expect(homedirMock).toHaveBeenCalledTimes(1);
      expect(process.env.TEST_BLA).toBe('234');
    });
  });
});
