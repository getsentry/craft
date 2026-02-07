import { vi } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
// XXX(BYK): This is to be able to spy on `homedir()` in tests
// TODO(BYK): Convert this to ES6 imports
import os = require('os');

import * as config from '../../config';
import {
  checkEnvForPrerequisite,
  readEnvironmentConfig,
  ENV_FILE_NAME,
} from '../env';
import { ConfigurationError } from '../errors';
import { logger } from '../../logger';
import { withTempDir } from '../files';

vi.mock('../../logger');
const homedirMock = vi.spyOn(os, 'homedir');
const getConfigFileDirMock = vi.spyOn(config, 'getConfigFileDir');

describe('env utils functions', () => {
  const cleanEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...cleanEnv };
    vi.resetAllMocks();
  });

  describe('checkEnvForPrerequisite', () => {
    it('runs', () => {
      process.env.DOGS = 'RULE'; // just to prevent the function erroring
      checkEnvForPrerequisite({ name: 'DOGS' });
      expect(logger.debug).toHaveBeenCalledWith(
        'Checking for environment variable:',
        'DOGS',
      );
    });

    describe('no legacy name', () => {
      it('finds correctly set var', () => {
        process.env.DOGS = 'RULE';
        checkEnvForPrerequisite({ name: 'DOGS' });
        expect(logger.debug).toHaveBeenCalledWith(`Found DOGS`);
      });

      it('errors if var not set', () => {
        expect(() => checkEnvForPrerequisite({ name: 'DOGS' })).toThrowError(
          ConfigurationError,
        );
      });
    }); // end describe('no legacy name')

    describe('with legacy name', () => {
      it('handles both new and legacy variable being set', () => {
        process.env.DOGS = 'RULE';
        process.env.CATS = 'DROOL';
        checkEnvForPrerequisite({ name: 'DOGS', legacyName: 'CATS' });
        expect(logger.warn).toHaveBeenCalledWith(
          `When searching configuration files and your environment, found DOGS ` +
            `but also found legacy CATS. Do you mean to be using both?`,
        );
      });

      it('handles only new variable being set', () => {
        process.env.DOGS = 'RULE';
        checkEnvForPrerequisite({ name: 'DOGS', legacyName: 'CATS' });
        expect(logger.debug).toHaveBeenCalledWith('Found DOGS');
      });

      it('handles only legacy variable being set, and copies value to new variable', () => {
        process.env.CATS = 'DROOL';
        checkEnvForPrerequisite({ name: 'DOGS', legacyName: 'CATS' });
        expect(logger.warn).toHaveBeenCalledWith(
          `Usage of CATS is deprecated, and will be removed in later versions. ` +
            `Please use DOGS instead.`,
        );
        expect(process.env.DOGS).toEqual('DROOL');
      });

      it('errors if neither is set', () => {
        expect(() =>
          checkEnvForPrerequisite({ name: 'DOGS', legacyName: 'CATS' }),
        ).toThrowError(ConfigurationError);
      });
    }); // end describe('with legacy name')

    describe('multiple options', () => {
      it('checks for multiple variables', () => {
        // don't set either variable to force it to look for both (but that makes
        // it error, so `expect` the error to catch it so it doesn't break the
        // test)
        expect(() =>
          checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' }),
        ).toThrowError(ConfigurationError);
        expect(logger.debug).toHaveBeenCalledWith(
          'Checking for environment variable(s):',
          'MAISEY or CHARLIE',
        );
        expect(logger.debug).toHaveBeenCalledWith(
          'Checking for environment variable:',
          'MAISEY',
        );
        expect(logger.debug).toHaveBeenCalledWith(
          'Checking for environment variable:',
          'CHARLIE',
        );
      });

      it('is happy if either option is defined', () => {
        process.env.MAISEY = 'GOOD DOG';
        expect(() =>
          checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' }),
        ).not.toThrowError(ConfigurationError);
        expect(logger.debug).toHaveBeenCalledWith('Found MAISEY');

        delete process.env.MAISEY;
        process.env.CHARLIE = 'ALSO GOOD DOG';
        expect(() =>
          checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' }),
        ).not.toThrowError(ConfigurationError);
        expect(logger.debug).toHaveBeenCalledWith('Found CHARLIE');
      });

      it('throws if neither one is defined', () => {
        // skip defining vars here
        expect(() =>
          checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' }),
        ).toThrowError(ConfigurationError);
      });

      it('handles a mix of variables with and without legacy names', () => {
        process.env.MAISEY = 'GOOD DOG';
        expect(() =>
          checkEnvForPrerequisite(
            { name: 'MAISEY' },
            { name: 'CHARLIE', legacyName: 'OPAL' },
          ),
        ).not.toThrowError(ConfigurationError);
        expect(logger.debug).toHaveBeenCalledWith('Found MAISEY');

        delete process.env.MAISEY;
        process.env.OPAL = 'GOOD PUPPY';
        expect(() =>
          checkEnvForPrerequisite(
            { name: 'MAISEY' },
            { name: 'CHARLIE', legacyName: 'OPAL' },
          ),
        ).not.toThrowError(ConfigurationError);
        expect(logger.warn).toHaveBeenCalledWith(
          `Usage of OPAL is deprecated, and will be removed in later versions. ` +
            `Please use CHARLIE instead.`,
        );
        expect(process.env.CHARLIE).toEqual('GOOD PUPPY');
      });
    }); // end describe('multiple variables')
  }); // end describe('checkEnvForPrerequisites')

  describe('readEnvironmentConfig', () => {
    const invalidDir = '/invalid/invalid';

    function writeConfigFileSync(directory: string): void {
      const outConfigFile = join(directory, config.CONFIG_FILE_NAME);
      writeFileSync(outConfigFile, '');
    }

    test('calls homedir/findConfigFile', () => {
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

      await withTempDir(directory => {
        getConfigFileDirMock.mockReturnValue(directory);

        writeConfigFileSync(directory);

        const outFile = join(directory, ENV_FILE_NAME);
        writeFileSync(outFile, 'export TEST_BLA=234\nexport TEST_ANOTHER=345');

        readEnvironmentConfig();

        expect(process.env.TEST_BLA).toBe('234');
      });
    });
    test('checks home directory', async () => {
      getConfigFileDirMock.mockReturnValue(invalidDir);

      await withTempDir(directory => {
        homedirMock.mockReturnValue(directory);
        const outFile = join(directory, ENV_FILE_NAME);
        writeFileSync(outFile, 'export TEST_BLA=234\n');

        readEnvironmentConfig();

        expect(process.env.TEST_BLA).toBe('234');
      });
    });

    test('checks home directory first, and then the config directory', async () => {
      await withTempDir(async dir1 => {
        await withTempDir(dir2 => {
          homedirMock.mockReturnValue(dir1);

          const outHome = join(dir1, ENV_FILE_NAME);
          writeFileSync(outHome, 'export TEST_BLA=from_home');

          getConfigFileDirMock.mockReturnValue(dir2);
          writeConfigFileSync(dir2);
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

      await withTempDir(directory => {
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

      await withTempDir(directory => {
        getConfigFileDirMock.mockReturnValue(directory);

        writeConfigFileSync(directory);

        const outFile = join(directory, ENV_FILE_NAME);
        writeFileSync(outFile, 'export TEST_BLA=new_value');

        readEnvironmentConfig(true);

        expect(process.env.TEST_BLA).toBe('new_value');
      });
    });
  }); // end describe('readEnvironmentConfig')
}); // end describe('env utils functions')
