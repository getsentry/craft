import { checkEnvForPrerequisites } from '../env';
import { logger } from '../../logger';
import { ConfigurationError } from '../errors';

jest.mock('../../logger');

describe('checkEnvForPrerequisites', () => {
  const cleanEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...cleanEnv };
    jest.resetAllMocks();
  });

  it('runs', () => {
    process.env.DOGS = 'RULE'; // just to prevent the function erroring
    checkEnvForPrerequisites(['DOGS']);
    expect(logger.debug).toHaveBeenCalledWith(
      `Checking for environment variable DOGS`
    );
  });

  describe('no legacy name', () => {
    it('finds correctly set var', () => {
      process.env.DOGS = 'RULE';
      checkEnvForPrerequisites(['DOGS']);
      expect(logger.debug).toHaveBeenCalledWith(`Found DOGS`);
    });

    it('errors if var not set', () => {
      expect(() => checkEnvForPrerequisites(['DOGS'])).toThrowError(
        ConfigurationError
      );
    });
  }); // end describe('no legacy name')

  describe('with legacy name', () => {
    it('handles both new and legacy variable being set', () => {
      process.env.DOGS = 'RULE';
      process.env.CATS = 'DROOL';
      checkEnvForPrerequisites([['DOGS', 'CATS']]);
      expect(logger.warn).toHaveBeenCalledWith(
        `When searching configuration files and your environment, found DOGS ` +
          `but also found legacy CATS. Do you mean to be using both?`
      );
    });

    it('handles only new variable being set', () => {
      process.env.DOGS = 'RULE';
      checkEnvForPrerequisites([['DOGS', 'CATS']]);
      expect(logger.debug).toHaveBeenCalledWith('Found DOGS');
    });

    it('handles only legacy variable being set', () => {
      process.env.CATS = 'DROOL';
      checkEnvForPrerequisites([['DOGS', 'CATS']]);
      expect(logger.warn).toHaveBeenCalledWith(
        `Usage of CATS is deprecated, and will be removed in later versions. ` +
          `Please use DOGS instead.`
      );
      expect(process.env.DOGS).toEqual('DROOL');
    });

    it('errors if neither is set', () => {
      expect(() => checkEnvForPrerequisites([['DOGS', 'CATS']])).toThrowError(
        ConfigurationError
      );
    });
  }); // end describe('with legacy name')

  describe('multiple variables', () => {
    it('checks for multiple variables', () => {
      process.env.MAISEY = 'GOOD DOG';
      process.env.CHARLIE = 'ALSO GOOD DOG';
      checkEnvForPrerequisites(['MAISEY', 'CHARLIE']);
      expect(logger.debug).toHaveBeenCalledWith(
        `Checking for environment variable MAISEY`
      );
      expect(logger.debug).toHaveBeenCalledWith(
        `Checking for environment variable CHARLIE`
      );
    });

    it('handles a mix of variables with and without legacy names', () => {
      process.env.MAISEY = 'GOOD DOG';
      process.env.OPAL = 'GOOD PUPPY';
      checkEnvForPrerequisites(['MAISEY', ['CHARLIE', 'OPAL']]);
      expect(logger.debug).toHaveBeenCalledWith('Found MAISEY');
      expect(logger.warn).toHaveBeenCalledWith(
        `Usage of OPAL is deprecated, and will be removed in later versions. ` +
          `Please use CHARLIE instead.`
      );
    });
  }); // end describe('multiple variables')
}); // end describe('checkEnvForPrerequisites')
