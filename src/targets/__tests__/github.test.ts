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
      githubTarget.getReleaseByTag = vi.fn().mockResolvedValue(undefined);
      githubTarget.getRelease = vi.fn().mockResolvedValue(mockDraftRelease);
      githubTarget.findDraftReleasesByTag = vi.fn().mockResolvedValue([]);
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

      expect(githubTarget.getRelease).toHaveBeenCalledWith(mockDraftRelease.id);
      expect(githubTarget.deleteRelease).toHaveBeenCalled();
    });

    it('still throws original error if cleanup also fails', async () => {
      const publishError = new Error('Publish failed');
      const cleanupError = new Error('Cleanup failed');

      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);
      githubTarget.getRelease = vi.fn().mockRejectedValue(cleanupError);

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );
    });

    it('does not delete release when publish succeeds', async () => {
      await githubTarget.publish('1.0.0', 'abc123');

      expect(githubTarget.deleteRelease).not.toHaveBeenCalled();
    });

    it('skips creation when release already exists and is published', async () => {
      const existingPublished = {
        id: 456,
        tag_name: '1.0.0',
        upload_url: 'https://example.com/upload',
        draft: false,
      };
      githubTarget.getReleaseByTag = vi
        .fn()
        .mockResolvedValue(existingPublished);

      await githubTarget.publish('1.0.0', 'abc123');

      expect(githubTarget.createDraftRelease).not.toHaveBeenCalled();
      expect(githubTarget.publishRelease).not.toHaveBeenCalled();
    });

    it('recovers from 422 by deleting leftover draft and retrying', async () => {
      const leftoverDraft = {
        id: 789,
        tag_name: '1.0.0',
        upload_url: 'https://example.com/upload',
        draft: true,
      };
      // First createDraftRelease call fails with 422 (leftover draft exists)
      // Second call succeeds after cleanup
      githubTarget.createDraftRelease = vi
        .fn()
        .mockRejectedValueOnce({ status: 422, message: 'Validation Failed' })
        .mockResolvedValueOnce(mockDraftRelease);
      githubTarget.findDraftReleasesByTag = vi
        .fn()
        .mockResolvedValue([leftoverDraft]);

      await githubTarget.publish('1.0.0', 'abc123');

      expect(githubTarget.findDraftReleasesByTag).toHaveBeenCalledWith('1.0.0');
      expect(githubTarget.deleteRelease).toHaveBeenCalledWith(leftoverDraft);
      expect(githubTarget.createDraftRelease).toHaveBeenCalledTimes(2);
      expect(githubTarget.publishRelease).toHaveBeenCalled();
    });

    it('re-fetches release before cleanup and skips delete when already published', async () => {
      const publishError = new Error('Publish failed');
      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);
      // Simulate half-succeeded: server published it but response timed out
      githubTarget.getRelease = vi.fn().mockResolvedValue({
        ...mockDraftRelease,
        draft: false,
      });

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );

      expect(githubTarget.getRelease).toHaveBeenCalledWith(mockDraftRelease.id);
      expect(githubTarget.deleteRelease).not.toHaveBeenCalled();
    });

    it('deletes draft release on failure when re-fetch confirms still a draft', async () => {
      const publishError = new Error('Publish failed');
      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);
      const refetchedDraft = { ...mockDraftRelease, draft: true };
      githubTarget.getRelease = vi.fn().mockResolvedValue(refetchedDraft);

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );

      expect(githubTarget.deleteRelease).toHaveBeenCalledWith(refetchedDraft);
    });

    it('handles release already deleted on failure gracefully', async () => {
      const publishError = new Error('Publish failed');
      githubTarget.publishRelease = vi.fn().mockRejectedValue(publishError);
      githubTarget.getRelease = vi.fn().mockResolvedValue(undefined);

      await expect(githubTarget.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Publish failed',
      );

      expect(githubTarget.deleteRelease).not.toHaveBeenCalled();
    });

    it('treats floating tag failure as non-fatal after successful publish', async () => {
      // updateFloatingTags is protected, so we spy on the prototype
      vi.spyOn(
        GitHubTarget.prototype as any,
        'updateFloatingTags',
      ).mockRejectedValue(new Error('Tag update failed'));

      // publish() should NOT throw despite floating tag failure
      await expect(
        githubTarget.publish('1.0.0', 'abc123'),
      ).resolves.toBeUndefined();

      expect(githubTarget.publishRelease).toHaveBeenCalled();
    });

    it('attempts floating tag updates when release already exists on re-run', async () => {
      const existingPublished = {
        id: 456,
        tag_name: '1.0.0',
        upload_url: 'https://example.com/upload',
        draft: false,
      };
      githubTarget.getReleaseByTag = vi
        .fn()
        .mockResolvedValue(existingPublished);
      const updateFloatingTagsSpy = vi
        .spyOn(GitHubTarget.prototype as any, 'updateFloatingTags')
        .mockResolvedValue(undefined);

      await githubTarget.publish('1.0.0', 'abc123');

      expect(updateFloatingTagsSpy).toHaveBeenCalled();
    });
  });

  describe('getRelease', () => {
    it('returns release data on success', async () => {
      const mockRelease = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
        draft: false,
      };
      githubTarget.github.repos.getRelease = vi
        .fn()
        .mockResolvedValue({ data: mockRelease }) as any;

      const result = await githubTarget.getRelease(123);
      expect(result).toEqual(mockRelease);
    });

    it('returns undefined on 404', async () => {
      githubTarget.github.repos.getRelease = vi
        .fn()
        .mockRejectedValue({ status: 404 }) as any;

      const result = await githubTarget.getRelease(999);
      expect(result).toBeUndefined();
    });

    it('re-throws non-404 errors', async () => {
      const serverError = { status: 500, message: 'Internal Server Error' };
      githubTarget.github.repos.getRelease = vi
        .fn()
        .mockRejectedValue(serverError) as any;

      await expect(githubTarget.getRelease(123)).rejects.toEqual(serverError);
    });
  });

  describe('getReleaseByTag', () => {
    it('returns release data on success', async () => {
      const mockRelease = {
        id: 123,
        tag_name: 'v1.0.0',
        upload_url: 'https://example.com/upload',
        draft: false,
      };
      githubTarget.github.repos.getReleaseByTag = vi
        .fn()
        .mockResolvedValue({ data: mockRelease }) as any;

      const result = await githubTarget.getReleaseByTag('v1.0.0');
      expect(result).toEqual(mockRelease);
    });

    it('returns undefined on 404', async () => {
      githubTarget.github.repos.getReleaseByTag = vi
        .fn()
        .mockRejectedValue({ status: 404 }) as any;

      const result = await githubTarget.getReleaseByTag('v99.99.99');
      expect(result).toBeUndefined();
    });

    it('re-throws non-404 errors', async () => {
      const serverError = { status: 500, message: 'Internal Server Error' };
      githubTarget.github.repos.getReleaseByTag = vi
        .fn()
        .mockRejectedValue(serverError) as any;

      await expect(githubTarget.getReleaseByTag('v1.0.0')).rejects.toEqual(
        serverError,
      );
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

  describe('findDraftReleasesByTag', () => {
    it('returns only draft releases matching the tag', async () => {
      const releases = [
        { id: 1, tag_name: 'v1.0.0', draft: true, upload_url: '' },
        { id: 2, tag_name: 'v1.0.0', draft: false, upload_url: '' },
        { id: 3, tag_name: 'v2.0.0', draft: true, upload_url: '' },
      ];
      githubTarget.github.repos.listReleases = vi
        .fn()
        .mockResolvedValue({ data: releases }) as any;

      const result = await githubTarget.findDraftReleasesByTag('v1.0.0');

      expect(result).toEqual([
        { id: 1, tag_name: 'v1.0.0', draft: true, upload_url: '' },
      ]);
    });

    it('returns empty array when no drafts match', async () => {
      const releases = [
        { id: 1, tag_name: 'v1.0.0', draft: false, upload_url: '' },
      ];
      githubTarget.github.repos.listReleases = vi
        .fn()
        .mockResolvedValue({ data: releases }) as any;

      const result = await githubTarget.findDraftReleasesByTag('v1.0.0');

      expect(result).toEqual([]);
    });
  });
});
