import { describe, expect, test, vi } from 'vitest';

vi.mock('../../../config', () => ({
  getWorkspaceNames: vi.fn(),
}));
vi.mock('../../../utils/strings', () => ({
  formatJson: vi.fn(value => JSON.stringify(value)),
}));

import { getWorkspaceNames } from '../../../config';
import { handler } from '../list';

describe('workspace list command', () => {
  test('prints exact configured workspace names', () => {
    vi.mocked(getWorkspaceNames).mockReturnValue(['cli', 'mcp.v2']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    handler();

    expect(log).toHaveBeenCalledWith('["cli","mcp.v2"]');
  });

  test('prints an empty array when no workspaces are configured', () => {
    vi.mocked(getWorkspaceNames).mockReturnValue([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    handler();

    expect(log).toHaveBeenCalledWith('[]');
  });
});
