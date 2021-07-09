import { NoneArtifactProvider } from '../../artifact_providers/none';
import { checkExecutableIsPresent } from '../../utils/system';
import { SymbolCollector, SYM_COLLECTOR_BIN_NAME } from '../symbolCollector';

jest.mock('../../utils/system');

function getSymbolCollectorInstance(
  customConfig?: Record<string, unknown>
): SymbolCollector {
  const config = customConfig
    ? customConfig
    : {
        ['testKey']: 'testVal',
      };
  return new SymbolCollector(
    {
      name: 'aws-lambda-layer',
      ...config,
    },
    new NoneArtifactProvider()
  );
}

describe('target config', () => {
  test('symbol collector not present in path', () => {
    (checkExecutableIsPresent as jest.MockedFunction<
      typeof checkExecutableIsPresent
    >).mockImplementationOnce(() => {
      throw new Error('Checked for executable');
    });

    expect(getSymbolCollectorInstance).toThrowErrorMatchingInlineSnapshot(
      `"Checked for executable"`
    );
    expect(checkExecutableIsPresent).toHaveBeenCalledTimes(1);
    expect(checkExecutableIsPresent).toHaveBeenCalledWith(
      SYM_COLLECTOR_BIN_NAME
    );
  });

  test('config missing', () => {
    (checkExecutableIsPresent as jest.MockedFunction<
      typeof checkExecutableIsPresent
    >) = jest.fn();

    expect(getSymbolCollectorInstance).toThrowErrorMatchingInlineSnapshot(
      `"Required configuration not found in configuration file. See the documentation for more details."`
    );
    expect(checkExecutableIsPresent).toHaveBeenCalledTimes(1);
    expect(checkExecutableIsPresent).toHaveBeenCalledWith(
      SYM_COLLECTOR_BIN_NAME
    );
  });

  test('symbol collector present and config ok', () => {
    (checkExecutableIsPresent as jest.MockedFunction<
      typeof checkExecutableIsPresent
    >) = jest.fn();

    const customConfig = {
      batchType: 'batch type',
      bundleIdPrefix: 'bundle id prefix',
    };

    const symCollector = getSymbolCollectorInstance(customConfig);
    const actualConfig = symCollector.symbolCollectorConfig;
    expect(checkExecutableIsPresent).toHaveBeenCalledTimes(1);
    expect(checkExecutableIsPresent).toHaveBeenLastCalledWith(
      SYM_COLLECTOR_BIN_NAME
    );
    expect(actualConfig).toHaveProperty('serverEndpoint');
    expect(actualConfig).toHaveProperty('batchType');
    expect(actualConfig).toHaveProperty('bundleIdPrefix');
  });
});
