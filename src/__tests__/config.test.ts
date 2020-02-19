/**
 * Tests of our ability to read craft config files and env vars (NOT general
 * test configuration).
 */

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { compile } from 'json-schema-to-typescript';

import {
  CONFIG_FILE_NAME,
  ENV_FILE_NAME,
  getProjectConfigSchema,
  readEnvironmentConfig,
  validateConfiguration,
} from '../config';
import { withTempDir } from '../utils/files';

jest.mock('os', () => ({ ...require.requireActual('os'), homedir: jest.fn() }));

// Mock getConfigFileDir
// tslint:disable-next-line:no-var-requires
const configModule = require('../config');
const getConfigFileDirMock = (configModule.getConfigFileDir = jest.fn());

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
  // const getConfigFileDirMock = getConfigFileDir as jest.Mock;
  const homedirMock = homedir as jest.Mock;

  const invalidDir = '/invalid/invalid';

  function writeConfigFile(directory: string): void {
    const outConfigFile = join(directory, CONFIG_FILE_NAME);
    writeFileSync(outConfigFile, '');
  }

  beforeEach(() => {
    delete process.env.TEST_BLA;
    jest.clearAllMocks();
  });
  test('calls homedir/findConfigFile', async () => {
    process.env.TEST_BLA = '123';

    homedirMock.mockReturnValue(invalidDir);
    getConfigFileDirMock.mockReturnValue(invalidDir);

    readEnvironmentConfig();

    expect(getConfigFileDirMock).toHaveBeenCalledTimes(1);
    expect(homedirMock).toHaveBeenCalledTimes(1);
    expect(process.env.TEST_BLA).toBe('123');
    expect(ENV_FILE_NAME.length).toBeGreaterThanOrEqual(1);
  });

  test('checks the config directory', async () => {
    homedirMock.mockReturnValue(invalidDir);
    delete process.env.TEST_BLA;

    await withTempDir(async directory => {
      getConfigFileDirMock.mockReturnValue(directory);

      writeConfigFile(directory);

      const outFile = join(directory, ENV_FILE_NAME);
      writeFileSync(outFile, 'export TEST_BLA=234\nexport TEST_ANOTHER=345');

      readEnvironmentConfig();

      expect(process.env.TEST_BLA).toBe('234');
    });
  });
  test('checks home directory', async () => {
    getConfigFileDirMock.mockReturnValue(invalidDir);
    delete process.env.TEST_BLA;

    await withTempDir(async directory => {
      homedirMock.mockReturnValue(directory);
      const outFile = join(directory, ENV_FILE_NAME);
      writeFileSync(outFile, 'export TEST_BLA=234\n');

      readEnvironmentConfig();

      expect(process.env.TEST_BLA).toBe('234');
    });
  });

  test('checks home directory first, and then the config directory', async () => {
    delete process.env.TEST_BLA;

    await withTempDir(async dir1 => {
      await withTempDir(async dir2 => {
        homedirMock.mockReturnValue(dir1);

        const outHome = join(dir1, ENV_FILE_NAME);
        writeFileSync(outHome, 'export TEST_BLA=from_home');

        getConfigFileDirMock.mockReturnValue(dir2);
        writeConfigFile(dir2);
        const configDirFile = join(dir2, ENV_FILE_NAME);
        writeFileSync(configDirFile, 'export TEST_BLA=from_config_dir');

        readEnvironmentConfig();

        expect(process.env.TEST_BLA).toBe('from_config_dir');
      });
    });
  });

  test('does not overwrite existing variables by default', async () => {
    homedirMock.mockReturnValue(invalidDir);

    process.env.TEST_BLA = 'existing';

    await withTempDir(async directory => {
      getConfigFileDirMock.mockReturnValue(directory);
      const outFile = join(directory, ENV_FILE_NAME);
      writeFileSync(outFile, 'export TEST_BLA=new_value');

      readEnvironmentConfig();

      expect(process.env.TEST_BLA).toBe('existing');
    });
  });

  test('overwrites existing variables if explicitly stated', async () => {
    homedirMock.mockReturnValue(invalidDir);

    process.env.TEST_BLA = 'existing';

    await withTempDir(async directory => {
      getConfigFileDirMock.mockReturnValue(directory);

      writeConfigFile(directory);

      const outFile = join(directory, ENV_FILE_NAME);
      writeFileSync(outFile, 'export TEST_BLA=new_value');

      readEnvironmentConfig(true);

      expect(process.env.TEST_BLA).toBe('new_value');
    });
  });
});
