import { withTempDir } from '../../utils/files';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { checkExecutableIsPresent, spawnProcess } from '../../utils/system';
import { SymbolCollector, SYM_COLLECTOR_BIN_NAME } from '../symbolCollector';

jest.mock('../../utils/files');
jest.mock('../../utils/system');
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    promises: {
      mkdir: jest.fn(() => {
        /** do nothing */
      }),
    },
  };
});

const customConfig = {
  batchType: 'batchType',
  bundleIdPrefix: 'bundleIdPrefix-',
};

function getSymbolCollectorInstance(
  config: Record<string, unknown> = { testKey: 'testVal' }
): SymbolCollector {
  return new SymbolCollector(
    {
      name: 'symbol-collector',
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
      '"The required `batchType` parameter is missing in the configuration file. ' +
        'See the documentation for more details."'
    );
  });

  test('symbol collector present and config ok', () => {
    (checkExecutableIsPresent as jest.MockedFunction<
      typeof checkExecutableIsPresent
    >) = jest.fn();

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

describe('publish', () => {
  test('no artifacts found', () => {
    const symCollector = getSymbolCollectorInstance(customConfig);
    symCollector.getArtifactsForRevision = jest
      .fn()
      .mockReturnValueOnce(() => []);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  test('with artifacts', async () => {
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => await cb('tmpDir')
    );
    (spawnProcess as jest.MockedFunction<
      typeof spawnProcess
    >).mockImplementation(() => Promise.resolve(undefined));

    const mockedArtifacts = ['artifact1', 'artifact2', 'artifact3'];

    const symCollector = getSymbolCollectorInstance(customConfig);
    symCollector.getArtifactsForRevision = jest
      .fn()
      .mockReturnValueOnce(mockedArtifacts);
    symCollector.artifactProvider.downloadArtifact = jest.fn();

    await symCollector.publish('version', 'revision');

    expect(symCollector.getArtifactsForRevision).toHaveBeenCalledTimes(1);
    expect(
      symCollector.artifactProvider.downloadArtifact
    ).toHaveBeenCalledTimes(mockedArtifacts.length);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [cmd, args] = (spawnProcess as jest.MockedFunction<
      typeof spawnProcess
    >).mock.calls[0] as string[];
    expect(cmd).toBe(SYM_COLLECTOR_BIN_NAME);
    expect(args).toMatchInlineSnapshot(`
      [
        "--upload",
        "directory",
        "--path",
        "tmpDir",
        "--batch-type",
        "batchType",
        "--bundle-id",
        "bundleIdPrefix-version",
        "--server-endpoint",
        "https://symbol-collector.services.sentry.io/",
      ]
    `);
  });
});
