import { checkEnvForPrerequisite } from '../env';
import { logger } from '../../logger';
import { ConfigurationError } from '../errors';

jest.mock('../../logger');

describe('checkEnvForPrerequisite', () => {
  const cleanEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...cleanEnv };
    jest.resetAllMocks();
  });

  it('runs', () => {
    process.env.DOGS = 'RULE'; // just to prevent the function erroring
    checkEnvForPrerequisite({ name: 'DOGS' });
    expect(logger.debug).toHaveBeenCalledWith(
      `\tChecking for environment variable DOGS`
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
        ConfigurationError
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
          `but also found legacy CATS. Do you mean to be using both?`
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
          `Please use DOGS instead.`
      );
      expect(process.env.DOGS).toEqual('DROOL');
    });

    it('errors if neither is set', () => {
      expect(() =>
        checkEnvForPrerequisite({ name: 'DOGS', legacyName: 'CATS' })
      ).toThrowError(ConfigurationError);
    });
  }); // end describe('with legacy name')

  describe('multiple options', () => {
    it('checks for multiple variables', () => {
      // don't set either variable to force it to look for both (but that makes
      // it error, so `expect` the error to catch it so it doesn't break the
      // test)
      expect(() =>
        checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' })
      ).toThrowError(ConfigurationError);
      expect(logger.debug).toHaveBeenCalledWith(
        `Checking for environment variable(s) MAISEY or CHARLIE`
      );
      expect(logger.debug).toHaveBeenCalledWith(
        `\tChecking for environment variable MAISEY`
      );
      expect(logger.debug).toHaveBeenCalledWith(
        `\tChecking for environment variable CHARLIE`
      );
    });

    it('is happy if either option is defined', () => {
      process.env.MAISEY = 'GOOD DOG';
      expect(() =>
        checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' })
      ).not.toThrowError(ConfigurationError);
      expect(logger.debug).toHaveBeenCalledWith('Found MAISEY');

      delete process.env.MAISEY;
      process.env.CHARLIE = 'ALSO GOOD DOG';
      expect(() =>
        checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' })
      ).not.toThrowError(ConfigurationError);
      expect(logger.debug).toHaveBeenCalledWith('Found CHARLIE');
    });

    it('throws if neither one is defined', () => {
      // skip defining vars here
      expect(() =>
        checkEnvForPrerequisite({ name: 'MAISEY' }, { name: 'CHARLIE' })
      ).toThrowError(ConfigurationError);
    });

    it('handles a mix of variables with and without legacy names', () => {
      process.env.MAISEY = 'GOOD DOG';
      expect(() =>
        checkEnvForPrerequisite(
          { name: 'MAISEY' },
          { name: 'CHARLIE', legacyName: 'OPAL' }
        )
      ).not.toThrowError(ConfigurationError);
      expect(logger.debug).toHaveBeenCalledWith('Found MAISEY');

      delete process.env.MAISEY;
      process.env.OPAL = 'GOOD PUPPY';
      expect(() =>
        checkEnvForPrerequisite(
          { name: 'MAISEY' },
          { name: 'CHARLIE', legacyName: 'OPAL' }
        )
      ).not.toThrowError(ConfigurationError);
      expect(logger.warn).toHaveBeenCalledWith(
        `Usage of OPAL is deprecated, and will be removed in later versions. ` +
          `Please use CHARLIE instead.`
      );
      expect(process.env.CHARLIE).toEqual('GOOD PUPPY');
    });
  }); // end describe('multiple variables')
}); // end describe('checkEnvForPrerequisites')
