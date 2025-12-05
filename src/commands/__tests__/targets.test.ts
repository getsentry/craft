import { handler } from '../targets';

jest.mock('../../config', () => ({
  getConfiguration: jest.fn(),
  expandWorkspaceTargets: jest.fn(),
}));

jest.mock('../../targets', () => ({
  getAllTargetNames: jest.fn(),
}));

import { getConfiguration, expandWorkspaceTargets } from '../../config';
import { getAllTargetNames } from '../../targets';

describe('targets command', () => {
  const mockedGetConfiguration = getConfiguration as jest.Mock;
  const mockedExpandWorkspaceTargets = expandWorkspaceTargets as jest.Mock;
  const mockedGetAllTargetNames = getAllTargetNames as jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('lists targets without expansion when no workspaces', async () => {
    const targets = [
      { name: 'npm' },
      { name: 'github' },
    ];

    mockedGetConfiguration.mockReturnValue({ targets });
    mockedExpandWorkspaceTargets.mockResolvedValue(targets);
    mockedGetAllTargetNames.mockReturnValue(['npm', 'github', 'pypi']);

    await handler();

    expect(mockedExpandWorkspaceTargets).toHaveBeenCalledWith(targets);
    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual(['npm', 'github']);
  });

  test('lists expanded workspace targets', async () => {
    const originalTargets = [
      { name: 'npm', workspaces: true },
      { name: 'github' },
    ];

    const expandedTargets = [
      { name: 'npm', id: '@sentry/core' },
      { name: 'npm', id: '@sentry/browser' },
      { name: 'github' },
    ];

    mockedGetConfiguration.mockReturnValue({ targets: originalTargets });
    mockedExpandWorkspaceTargets.mockResolvedValue(expandedTargets);
    mockedGetAllTargetNames.mockReturnValue(['npm', 'github']);

    await handler();

    expect(mockedExpandWorkspaceTargets).toHaveBeenCalledWith(originalTargets);
    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual([
      'npm[@sentry/core]',
      'npm[@sentry/browser]',
      'github',
    ]);
  });

  test('filters out unknown target names', async () => {
    const targets = [
      { name: 'npm' },
      { name: 'unknown-target' },
      { name: 'github' },
    ];

    mockedGetConfiguration.mockReturnValue({ targets });
    mockedExpandWorkspaceTargets.mockResolvedValue(targets);
    mockedGetAllTargetNames.mockReturnValue(['npm', 'github']);

    await handler();

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual(['npm', 'github']);
  });

  test('handles empty targets list', async () => {
    mockedGetConfiguration.mockReturnValue({ targets: [] });
    mockedExpandWorkspaceTargets.mockResolvedValue([]);
    mockedGetAllTargetNames.mockReturnValue(['npm', 'github']);

    await handler();

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual([]);
  });

  test('handles undefined targets', async () => {
    mockedGetConfiguration.mockReturnValue({});
    mockedExpandWorkspaceTargets.mockResolvedValue([]);
    mockedGetAllTargetNames.mockReturnValue(['npm', 'github']);

    await handler();

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual([]);
  });
});
