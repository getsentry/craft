import { vi, type MockedFunction } from 'vitest';
import { withTempDir } from '../../utils/files';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { checkExecutableIsPresent, spawnProcess } from '../../utils/system';
import { SymbolCollector, SYM_COLLECTOR_BIN_NAME } from '../symbolCollector';

vi.mock('../../utils/files');
vi.mock('../../utils/system');
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      mkdir: vi.fn(() => {
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
  config: Record<string, unknown> = { testKey: 'testVal' },
): SymbolCollector {
  return new SymbolCollector(
    {
      name: 'symbol-collector',
      ...config,
    },
    new NoneArtifactProvider(),
  );
}

describe('target config', () => {
  test('symbol collector not present in path', () => {
    (
      checkExecutableIsPresent as MockedFunction<
        typeof checkExecutableIsPresent
      >
    ).mockImplementationOnce(() => {
      throw new Error('Checked for executable');
    });

    expect(getSymbolCollectorInstance).toThrowErrorMatchingInlineSnapshot(
      `[Error: Checked for executable]`,
    );
    expect(checkExecutableIsPresent).toHaveBeenCalledTimes(1);
    expect(checkExecutableIsPresent).toHaveBeenCalledWith(
      SYM_COLLECTOR_BIN_NAME,
    );
  });

  test('config missing', () => {
    (checkExecutableIsPresent as MockedFunction<
      typeof checkExecutableIsPresent
    >) = vi.fn();

    expect(getSymbolCollectorInstance).toThrowErrorMatchingInlineSnapshot(
      `[Error: The required \`batchType\` parameter is missing in the configuration file. See the documentation for more details.]`,
    );
  });

  test('symbol collector present and config ok', () => {
    (checkExecutableIsPresent as MockedFunction<
      typeof checkExecutableIsPresent
    >) = vi.fn();

    const symCollector = getSymbolCollectorInstance(customConfig);
    const actualConfig = symCollector.symbolCollectorConfig;
    expect(checkExecutableIsPresent).toHaveBeenCalledTimes(1);
    expect(checkExecutableIsPresent).toHaveBeenLastCalledWith(
      SYM_COLLECTOR_BIN_NAME,
    );
    expect(actualConfig).toHaveProperty('serverEndpoint');
    expect(actualConfig).toHaveProperty('batchType');
    expect(actualConfig).toHaveProperty('bundleIdPrefix');
  });
});

describe('publish', () => {
  test('no artifacts found', () => {
    const symCollector = getSymbolCollectorInstance(customConfig);
    symCollector.getArtifactsForRevision = vi
      .fn()
      .mockReturnValueOnce(() => []);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  test('with artifacts', async () => {
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => await cb('tmpDir'),
    );
    (spawnProcess as MockedFunction<typeof spawnProcess>).mockImplementation(
      () => Promise.resolve(undefined),
    );

    const mockedArtifacts = ['artifact1', 'artifact2', 'artifact3'];

    const symCollector = getSymbolCollectorInstance(customConfig);
    symCollector.getArtifactsForRevision = vi
      .fn()
      .mockReturnValueOnce(mockedArtifacts);
    symCollector.artifactProvider.downloadArtifact = vi.fn();

    await symCollector.publish('version', 'revision');

    expect(symCollector.getArtifactsForRevision).toHaveBeenCalledTimes(1);
    expect(
      symCollector.artifactProvider.downloadArtifact,
    ).toHaveBeenCalledTimes(mockedArtifacts.length);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [cmd, args] = (spawnProcess as MockedFunction<typeof spawnProcess>)
      .mock.calls[0] as string[];
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
