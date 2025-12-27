import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import { formatCalVerDate, calculateCalVer, DEFAULT_CALVER_CONFIG } from '../calver';

// Mock the config module to control tagPrefix
vi.mock('../../config', () => ({
  getGitTagPrefix: vi.fn(() => ''),
}));

import { getGitTagPrefix } from '../../config';

const mockGetGitTagPrefix = getGitTagPrefix as Mock;

describe('formatCalVerDate', () => {
  it('formats %y as 2-digit year', () => {
    const date = new Date('2024-12-15');
    expect(formatCalVerDate(date, '%y')).toBe('24');
  });

  it('formats %Y as 4-digit year', () => {
    const date = new Date('2024-12-15');
    expect(formatCalVerDate(date, '%Y')).toBe('2024');
  });

  it('formats %m as zero-padded month', () => {
    const date = new Date('2024-01-15');
    expect(formatCalVerDate(date, '%m')).toBe('01');

    const date2 = new Date('2024-12-15');
    expect(formatCalVerDate(date2, '%m')).toBe('12');
  });

  it('formats %-m as month without padding', () => {
    const date = new Date('2024-01-15');
    expect(formatCalVerDate(date, '%-m')).toBe('1');

    const date2 = new Date('2024-12-15');
    expect(formatCalVerDate(date2, '%-m')).toBe('12');
  });

  it('formats %d as zero-padded day', () => {
    const date = new Date('2024-12-05');
    expect(formatCalVerDate(date, '%d')).toBe('05');

    const date2 = new Date('2024-12-25');
    expect(formatCalVerDate(date2, '%d')).toBe('25');
  });

  it('formats %-d as day without padding', () => {
    const date = new Date('2024-12-05');
    expect(formatCalVerDate(date, '%-d')).toBe('5');

    const date2 = new Date('2024-12-25');
    expect(formatCalVerDate(date2, '%-d')).toBe('25');
  });

  it('handles the default format %y.%-m', () => {
    const date = new Date('2024-12-15');
    expect(formatCalVerDate(date, '%y.%-m')).toBe('24.12');

    const date2 = new Date('2024-01-15');
    expect(formatCalVerDate(date2, '%y.%-m')).toBe('24.1');
  });

  it('handles complex format strings', () => {
    const date = new Date('2024-03-05');
    expect(formatCalVerDate(date, '%Y.%m.%d')).toBe('2024.03.05');
    expect(formatCalVerDate(date, '%y.%-m.%-d')).toBe('24.3.5');
  });
});

describe('calculateCalVer', () => {
  const mockGit = {
    tags: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitTagPrefix.mockReturnValue('');
    // Mock Date to return a fixed date
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-23'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns first patch version when no tags exist', async () => {
    mockGit.tags.mockResolvedValue({ all: [] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.0');
  });

  it('increments patch version when tag exists', async () => {
    mockGit.tags.mockResolvedValue({ all: ['24.12.0'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.1');
  });

  it('finds the highest patch and increments', async () => {
    mockGit.tags.mockResolvedValue({ all: ['24.12.0', '24.12.1', '24.12.2'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.3');
  });

  it('ignores tags from different date parts', async () => {
    mockGit.tags.mockResolvedValue({ all: ['24.11.0', '24.11.1', '23.12.0'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.0');
  });

  it('applies offset correctly', async () => {
    // Date is 2024-12-23, with 14 day offset should be 2024-12-09 (still December)
    mockGit.tags.mockResolvedValue({ all: [] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 14,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.0');
  });

  it('applies large offset that changes month', async () => {
    // Date is 2024-12-23, with 30 day offset should be 2024-11-23
    mockGit.tags.mockResolvedValue({ all: [] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 30,
      format: '%y.%-m',
    });

    expect(version).toBe('24.11.0');
  });

  it('handles non-numeric patch suffixes gracefully', async () => {
    mockGit.tags.mockResolvedValue({ all: ['24.12.0', '24.12.beta', '24.12.1'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    expect(version).toBe('24.12.2');
  });

  it('uses default config values', () => {
    expect(DEFAULT_CALVER_CONFIG.offset).toBe(14);
    expect(DEFAULT_CALVER_CONFIG.format).toBe('%y.%-m');
  });

  it('accounts for git tag prefix when searching for existing tags', async () => {
    // When tagPrefix is 'v', tags are like 'v24.12.0'
    mockGetGitTagPrefix.mockReturnValue('v');
    mockGit.tags.mockResolvedValue({ all: ['v24.12.0', 'v24.12.1'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    // Should find v24.12.1 and increment to 24.12.2
    expect(version).toBe('24.12.2');
  });

  it('ignores tags without the configured prefix', async () => {
    mockGetGitTagPrefix.mockReturnValue('v');
    // Mix of prefixed and non-prefixed tags
    mockGit.tags.mockResolvedValue({ all: ['24.12.5', 'v24.12.0', 'v24.12.1'] });

    const version = await calculateCalVer(mockGit as any, {
      offset: 0,
      format: '%y.%-m',
    });

    // Should only find v24.12.0 and v24.12.1, increment to 24.12.2
    // The non-prefixed '24.12.5' should be ignored
    expect(version).toBe('24.12.2');
  });
});
