import { vi } from 'vitest';
import { pushArchiveToGitRepository } from '../commitOnGitRepository';

const { tarExtractMock } = vi.hoisted(() => ({
  tarExtractMock: vi.fn<(...args: any[]) => Promise<void>>(() =>
    Promise.resolve(),
  ),
}));

vi.mock('tar', async importOriginal => {
  const actual = await importOriginal<typeof import('tar')>();
  return {
    ...actual,
    x: tarExtractMock,
  };
});

const mockClone = vi.fn();
const mockCheckout = vi.fn();
const mockRaw = vi.fn();
const mockCommit = vi.fn();
const mockAddTag = vi.fn();

vi.mock('simple-git', () => ({
  default: () => ({
    clone: mockClone,
    checkout: mockCheckout,
    raw: mockRaw,
    commit: mockCommit,
    addTag: mockAddTag,
  }),
}));

const AUTH_ENV_VARS = ['GITHUB_API_TOKEN', 'GITHUB_TOKEN'] as const;
let savedAuthEnv: Record<string, string | undefined>;

beforeEach(() => {
  tarExtractMock.mockReset();
  tarExtractMock.mockImplementation(() => Promise.resolve(undefined));
  mockClone.mockReset();
  mockCheckout.mockReset();
  mockRaw.mockReset();
  mockCommit.mockReset();
  mockAddTag.mockReset();

  // Clear any auth tokens so the default (unauthenticated) expectations hold
  // even in CI, where GITHUB_TOKEN is set automatically.
  savedAuthEnv = {};
  for (const key of AUTH_ENV_VARS) {
    savedAuthEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AUTH_ENV_VARS) {
    if (savedAuthEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedAuthEnv[key];
    }
  }
});

test('Basic commit-on-git-repository functionality', async () => {
  await pushArchiveToGitRepository({
    archivePath: '/tmp/my-archive.tgz',
    branch: 'main',
    createTag: true,
    repositoryUrl: 'https://github.com/getsentry/sentry-deno',
    stripComponents: 1,
    version: '1.2.3',
  });

  expect(mockClone).toHaveBeenCalledWith(
    'https://github.com/getsentry/sentry-deno',
    expect.any(String),
  );
  expect(mockCheckout).toHaveBeenCalledWith('main');
  expect(mockRaw).toHaveBeenCalledWith('rm', '-r', '.');
  expect(tarExtractMock).toHaveBeenCalledWith({
    file: '/tmp/my-archive.tgz',
    cwd: expect.any(String),
    gzip: true,
    strip: 1,
  });
  expect(mockRaw).toHaveBeenCalledWith('add', '--all');
  expect(mockCommit).toHaveBeenCalledWith('release: 1.2.3');
  expect(mockAddTag).toHaveBeenCalledWith('1.2.3');
  expect(mockRaw).toHaveBeenCalledWith(
    'push',
    'https://github.com/getsentry/sentry-deno',
    '--force',
  );
  expect(mockRaw).toHaveBeenCalledWith(
    'push',
    'https://github.com/getsentry/sentry-deno',
    '--tags',
  );
});

test('No strip-components when not configured', async () => {
  await pushArchiveToGitRepository({
    archivePath: '/tmp/my-archive.tgz',
    branch: 'main',
    createTag: false,
    repositoryUrl: 'https://github.com/getsentry/sentry-deno',
    stripComponents: undefined,
    version: '1.2.3',
  });

  expect(tarExtractMock).toHaveBeenCalledWith({
    file: '/tmp/my-archive.tgz',
    cwd: expect.any(String),
    gzip: true,
    strip: 0,
  });
});

test('Shell-metacharacter archivePath does not reach a shell', async () => {
  // Regression guard: the previous `execSync(`tar -zxvf ${archivePath}`)`
  // pattern would interpret `;` / `$()` / backticks in the path if an
  // artifact provider ever returned such a value. `tar.x({ file })`
  // passes the path as a parameter with no shell involvement, so even
  // adversarial input is treated as a literal filename.
  const adversarial = '/tmp/evil;touch /tmp/CRAFT_INJECTION.tgz';

  await pushArchiveToGitRepository({
    archivePath: adversarial,
    branch: 'main',
    createTag: false,
    repositoryUrl: 'https://github.com/getsentry/sentry-deno',
    stripComponents: 0,
    version: '1.2.3',
  });

  expect(tarExtractMock).toHaveBeenCalledWith(
    expect.objectContaining({
      file: adversarial,
    }),
  );
  // No subprocess spawn occurred; tar.x received the literal string.
});

describe('With authentication', () => {
  test('adds GitHub pat to repository url', async () => {
    process.env['GITHUB_API_TOKEN'] = 'test-token';

    await pushArchiveToGitRepository({
      archivePath: '/tmp/my-archive.tgz',
      branch: 'main',
      createTag: true,
      repositoryUrl: 'https://github.com/getsentry/sentry-deno',
      stripComponents: 1,
      version: '1.2.3',
    });

    expect(mockClone).toHaveBeenCalledWith(
      'https://x-access-token:test-token@github.com/getsentry/sentry-deno',
      expect.any(String),
    );

    expect(mockRaw).toHaveBeenCalledWith(
      'push',
      'https://x-access-token:test-token@github.com/getsentry/sentry-deno',
      '--force',
    );

    expect(mockRaw).toHaveBeenCalledWith(
      'push',
      'https://x-access-token:test-token@github.com/getsentry/sentry-deno',
      '--tags',
    );
  });
});
