import { vi } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
// XXX(BYK): This is to be able to spy on `homedir()` in tests
// TODO(BYK): Convert this to ES6 imports
import os = require('os');

import * as config from '../../config';
import {
  checkEnvForPrerequisite,
  sanitizeDynamicLinkerEnv,
  warnIfCraftEnvFileExists,
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

  describe('warnIfCraftEnvFileExists', () => {
    const invalidDir = '/invalid/invalid';
    const LEGACY_FILE = '.craft.env';

    test('does not warn when no files exist', () => {
      homedirMock.mockReturnValue(invalidDir);
      getConfigFileDirMock.mockReturnValue(invalidDir);

      warnIfCraftEnvFileExists();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('does not warn when getConfigFileDir returns undefined', () => {
      homedirMock.mockReturnValue(invalidDir);
      getConfigFileDirMock.mockReturnValue(undefined);

      warnIfCraftEnvFileExists();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('warns when a legacy file exists in the home directory', async () => {
      getConfigFileDirMock.mockReturnValue(invalidDir);

      await withTempDir(directory => {
        homedirMock.mockReturnValue(directory);
        const outFile = join(directory, LEGACY_FILE);
        writeFileSync(outFile, 'export TEST_BLA=234\n');

        warnIfCraftEnvFileExists();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(outFile),
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('no longer reads this file'),
        );
      });
    });

    test('warns when a legacy file exists in the config directory', async () => {
      homedirMock.mockReturnValue(invalidDir);

      await withTempDir(directory => {
        getConfigFileDirMock.mockReturnValue(directory);
        const outFile = join(directory, LEGACY_FILE);
        writeFileSync(outFile, 'export TEST_BLA=234\n');

        warnIfCraftEnvFileExists();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(outFile),
        );
      });
    });

    test('warns once per location when both files exist', async () => {
      await withTempDir(async homeDir => {
        await withTempDir(configDir => {
          homedirMock.mockReturnValue(homeDir);
          getConfigFileDirMock.mockReturnValue(configDir);

          const homeFile = join(homeDir, LEGACY_FILE);
          const configFile = join(configDir, LEGACY_FILE);
          writeFileSync(homeFile, 'export TEST_BLA=from_home');
          writeFileSync(configFile, 'export TEST_BLA=from_config_dir');

          warnIfCraftEnvFileExists();

          expect(logger.warn).toHaveBeenCalledTimes(2);
          expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining(homeFile),
          );
          expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining(configFile),
          );
        });
      });
    });

    test('does not mutate process.env', async () => {
      homedirMock.mockReturnValue(invalidDir);

      await withTempDir(directory => {
        getConfigFileDirMock.mockReturnValue(directory);
        const outFile = join(directory, LEGACY_FILE);
        writeFileSync(outFile, 'export TEST_BLA=new_value');

        const before = process.env.TEST_BLA;
        warnIfCraftEnvFileExists();
        expect(process.env.TEST_BLA).toBe(before);
      });
    });
  }); // end describe('warnIfCraftEnvFileExists')

  describe('sanitizeDynamicLinkerEnv', () => {
    const DYNAMIC_LINKER_KEYS = [
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'LD_AUDIT',
      'DYLD_INSERT_LIBRARIES',
      'DYLD_LIBRARY_PATH',
      'DYLD_FRAMEWORK_PATH',
      'DYLD_FALLBACK_LIBRARY_PATH',
      'DYLD_FALLBACK_FRAMEWORK_PATH',
    ];

    beforeEach(() => {
      for (const key of DYNAMIC_LINKER_KEYS) {
        delete process.env[key];
      }
      delete process.env.CRAFT_ALLOW_DYNAMIC_LINKER_ENV;
    });

    test('does nothing when no dynamic-linker vars are set', () => {
      sanitizeDynamicLinkerEnv();

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    test('strips LD_PRELOAD and warns without logging the value', () => {
      const secret = '/tmp/attacker-preload.so';
      process.env.LD_PRELOAD = secret;

      sanitizeDynamicLinkerEnv();

      expect(process.env.LD_PRELOAD).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const warnArgs = (logger.warn as any).mock.calls[0];
      const combined = warnArgs.join(' ');
      expect(combined).toContain('LD_PRELOAD');
      // Value must NOT appear anywhere in the log call.
      expect(combined).not.toContain(secret);
    });

    test('strips every known dynamic-linker var when set', () => {
      for (const key of DYNAMIC_LINKER_KEYS) {
        process.env[key] = `value-for-${key}`;
      }

      sanitizeDynamicLinkerEnv();

      for (const key of DYNAMIC_LINKER_KEYS) {
        expect(process.env[key]).toBeUndefined();
      }
      expect(logger.warn).toHaveBeenCalledTimes(DYNAMIC_LINKER_KEYS.length);
    });

    test('preserves vars when CRAFT_ALLOW_DYNAMIC_LINKER_ENV=1', () => {
      process.env.CRAFT_ALLOW_DYNAMIC_LINKER_ENV = '1';
      process.env.LD_PRELOAD = '/tmp/legit.so';
      process.env.LD_LIBRARY_PATH = '/opt/lib';

      sanitizeDynamicLinkerEnv();

      expect(process.env.LD_PRELOAD).toBe('/tmp/legit.so');
      expect(process.env.LD_LIBRARY_PATH).toBe('/opt/lib');
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledTimes(1);
      const infoArgs = (logger.info as any).mock.calls[0];
      const combined = infoArgs.join(' ');
      expect(combined).toContain('LD_PRELOAD');
      expect(combined).toContain('LD_LIBRARY_PATH');
    });

    test('opt-out only applies when value is exactly "1"', () => {
      process.env.CRAFT_ALLOW_DYNAMIC_LINKER_ENV = 'true';
      process.env.LD_PRELOAD = '/tmp/x.so';

      sanitizeDynamicLinkerEnv();

      // "true" is not the magic opt-out value; var should still be stripped.
      expect(process.env.LD_PRELOAD).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  }); // end describe('sanitizeDynamicLinkerEnv')
}); // end describe('env utils functions')
