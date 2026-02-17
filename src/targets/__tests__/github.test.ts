import { vi } from 'vitest';
import {
  isLatestRelease,
  GitHubTarget,
  GITHUB_RELEASE_BODY_MAX,
} from '../github';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { setGlobals } from '../../utils/helpers';

describe('isLatestRelease', () => {
  it('works with missing latest release', () => {
    const latestRelease = undefined;
    const version = '1.2.3';

    const actual = isLatestRelease(latestRelease, version);
    expect(actual).toBe(true);
  });

  it('works with unparseable latest release', () => {
    const latestRelease = { tag_name: 'foo' };
    const version = '1.2.3';

    const actual = isLatestRelease(latestRelease, version);
    expect(actual).toBe(true);
  });

  it('works with unparseable new version', () => {
    const latestRelease = { tag_name: 'v1.0.0' };
    const version = 'foo';

    const actual = isLatestRelease(latestRelease, version);
    expect(actual).toBe(true);
  });

  describe('with v-prefix', () => {
    it('detects larger new version', () => {
      const latestRelease = { tag_name: 'v1.1.0' };
      const version = '1.2.0';

      const actual = isLatestRelease(latestRelease, version);
      expect(actual).toBe(true);
    });

    it('detects smaller new version', () => {
      const latestRelease = { tag_name: 'v1.1.0' };
      const version = '1.0.1';

      const actual = isLatestRelease(latestRelease, version);
      expect(actual).toBe(false);
    });
  });

  describe('without v-prefix', () => {
    it('detects larger new version', () => {
      const latestRelease = { tag_name: '1.1.0' };
      const version = '1.2.0';

      const actual = isLatestRelease(latestRelease, version);
      expect(actual).toBe(true);
    });

    it('detects smaller new version', () => {
      const latestRelease = { tag_name: '1.1.0' };
      const version = '1.0.1';

      const actual = isLatestRelease(latestRelease, version);
      expect(actual).toBe(false);
    });
  });
});

describe('GitHubTarget', () => {
  const cleanEnv = { ...process.env };
  let githubTarget: GitHubTarget;

  beforeEach(() => {
    process.env = {
      ...cleanEnv,
      GITHUB_TOKEN: 'test github token',
    };
    setGlobals({ 'dry-run': false, 'log-level': 'Info', 'no-input': true });
    vi.resetAllMocks();

    githubTarget = new GitHubTarget(
      { name: 'github' },
      new NoneArtifactProvider(),
      { owner: 'testOwner', repo: 'testRepo' },
    );
  });

  afterEach(() => {
    process.env = cleanEnv;
  });

  describe('publish', () => {
    const mockDraftRelease = {
      id: 123,
      tag_name: 'v1.0.0',
      upload_url: 'https://example.com/upload',
      draft: true,
    };

    beforeEach(() => {
      // Mock all the methods that publish depends on
      githubTarget.getArtifactsForRevision = vi.fn().mockResolvedValue([]);
      githubTarget.createDraftRelease = vi
        .fn()
        .mockResolvedValue(mockDraftRelease);
      githubTarget.deleteRelease = vi.fn().mockResolvedValue(true);
      githubTarget.publishRelease = vi.fn().mockResolvedValue(undefined);
      githubTarget.github.repos.getLatestRelease = vi.fn().mockRejectedValue({
        status: 404,
      }) as any;
    });

    it('cleans up draft release when publishRelease fails', async () => {
      const publishError = new Error('Publish failed');
      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );

      expect(githubTarget.deleteRelease).toHaveBeenCalledWith(mockDraftRelease);
    });

    it('still throws original error if deleteRelease also fails', async () => {
      const publishError = new Error('Publish failed');
      const deleteError = new Error('Delete failed');

      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);
      githubTarget.deleteRelease = vi.fn().mockRejectedValue(deleteError);

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );

      expect(githubTarget.deleteRelease).toHaveBeenCalledWith(mockDraftRelease);
    });

    it('does not delete release when publish succeeds', async () => {
      await githubTarget.publish('1.0.0', 'abc123');

      expect(githubTarget.deleteRelease).not.toHaveBeenCalled();
    });
  });

  describe('createDraftRelease', () => {
    let createReleaseSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createReleaseSpy = vi.fn().mockResolvedValue({
        data: {
          id: 1,
          tag_name: '1.0.0',
          upload_url: 'https://example.com/upload',
          draft: true,
        },
      });
      githubTarget.github.repos.createRelease = createReleaseSpy as any;
    });

    it('passes short body through unchanged', async () => {
      const changes = { name: '1.0.0', body: 'short body' };
      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      expect(createReleaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'short body' }),
      );
    });

    it('passes undefined body when changes have no body', async () => {
      const changes = { name: '1.0.0', body: '' };
      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      expect(createReleaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({ body: undefined }),
      );
    });

    it('truncates body exceeding GitHub limit with permalink', async () => {
      const longBody = 'line one\n'.repeat(20_000); // well over 125k chars
      const changes = {
        name: '1.0.0',
        body: longBody,
        startLine: 3,
        endLine: 500,
      };

      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      const calledBody = createReleaseSpy.mock.calls[0][0].body as string;
      expect(calledBody.length).toBeLessThanOrEqual(GITHUB_RELEASE_BODY_MAX);
      expect(calledBody).toContain(
        'https://github.com/testOwner/testRepo/blob/abc123/CHANGELOG.md#L3-L500',
      );
      expect(calledBody).toContain('full changelog');
    });

    it('truncates at a line boundary', async () => {
      const longBody = 'line one\n'.repeat(20_000);
      const changes = { name: '1.0.0', body: longBody };

      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      const calledBody = createReleaseSpy.mock.calls[0][0].body as string;
      // Verify the truncation cut at a newline, not mid-line.
      // The footer starts with \n\n---\n, so the content before it should be
      // the end of a complete line (the newline itself is excluded from
      // substring, but the line content is intact).
      const footerIndex = calledBody.indexOf('\n\n---\n');
      const contentBefore = calledBody.substring(0, footerIndex);
      const lastLine = contentBefore.split('\n').pop();
      expect(lastLine).toBe('line one');
    });

    it('omits line fragment from permalink when line info is absent', async () => {
      const longBody = 'x'.repeat(GITHUB_RELEASE_BODY_MAX + 1);
      const changes = { name: '1.0.0', body: longBody };

      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      const calledBody = createReleaseSpy.mock.calls[0][0].body as string;
      expect(calledBody).toContain(
        'https://github.com/testOwner/testRepo/blob/abc123/CHANGELOG.md)',
      );
      expect(calledBody).not.toContain('#L');
    });

    it('does not spread extra Changeset fields into the API call', async () => {
      const changes = {
        name: '1.0.0',
        body: 'some body',
        startLine: 5,
        endLine: 20,
      };
      await githubTarget.createDraftRelease('1.0.0', 'abc123', changes);

      const calledWith = createReleaseSpy.mock.calls[0][0];
      expect(calledWith).not.toHaveProperty('startLine');
      expect(calledWith).not.toHaveProperty('endLine');
    });
  });

  describe('deleteRelease', () => {
    it('deletes a draft release', async () => {
      const draftRelease = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
        draft: true,
      };

      const deleteReleaseSpy = vi.fn().mockResolvedValue({ status: 204 });
      githubTarget.github.repos.deleteRelease = deleteReleaseSpy as any;

      const result = await githubTarget.deleteRelease(draftRelease);

      expect(result).toBe(true);
      expect(deleteReleaseSpy).toHaveBeenCalledWith({
        release_id: 123,
        owner: 'testOwner',
        repo: 'testRepo',
        changelog: 'CHANGELOG.md',
        previewReleases: true,
        tagPrefix: '',
        tagOnly: false,
        floatingTags: [],
      });
    });

    it('refuses to delete a non-draft release', async () => {
      const publishedRelease = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
        draft: false,
      };

      const deleteReleaseSpy = vi.fn().mockResolvedValue({ status: 204 });
      githubTarget.github.repos.deleteRelease = deleteReleaseSpy as any;

      const result = await githubTarget.deleteRelease(publishedRelease);

      expect(result).toBe(false);
      expect(deleteReleaseSpy).not.toHaveBeenCalled();
    });

    it('allows deletion when draft status is undefined (backwards compatibility)', async () => {
      const releaseWithoutDraftFlag = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
      };

      const deleteReleaseSpy = vi.fn().mockResolvedValue({ status: 204 });
      githubTarget.github.repos.deleteRelease = deleteReleaseSpy as any;

      const result = await githubTarget.deleteRelease(releaseWithoutDraftFlag);

      expect(result).toBe(true);
      expect(deleteReleaseSpy).toHaveBeenCalled();
    });

    it('does not delete in dry-run mode', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', 'no-input': true });

      const draftRelease = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
        draft: true,
      };

      const deleteReleaseSpy = vi.fn().mockResolvedValue({ status: 204 });
      githubTarget.github.repos.deleteRelease = deleteReleaseSpy as any;

      const result = await githubTarget.deleteRelease(draftRelease);

      expect(result).toBe(false);
      expect(deleteReleaseSpy).not.toHaveBeenCalled();
    });
  });
});
