import { isLatestRelease } from '../github';

describe('isLatestRelease', () => {
  it('works with missing latest release', () => {
    const latestTag = undefined;
    const version = '1.2.3';

    const actual = isLatestRelease(latestTag, version);
    expect(actual).toBe(true);
  });

  it('works with unparseable latest release', () => {
    const latestTag = 'foo';
    const version = '1.2.3';

    const actual = isLatestRelease(latestTag, version);
    expect(actual).toBe(true);
  });

  it('works with unparseable new version', () => {
    const latestTag = 'v1.0.0';
    const version = 'foo';

    const actual = isLatestRelease(latestTag, version);
    expect(actual).toBe(true);
  });

  describe('with v-prefix', () => {
    it('detects larger new version', () => {
      const latestTag = 'v1.1.0';
      const version = '1.2.0';

      const actual = isLatestRelease(latestTag, version);
      expect(actual).toBe(true);
    });

    it('detects smaller new version', () => {
      const latestTag = 'v1.1.0';
      const version = '1.0.1';

      const actual = isLatestRelease(latestTag, version);
      expect(actual).toBe(false);
    });
  });

  describe('without v-prefix', () => {
    it('detects larger new version', () => {
      const latestTag = '1.1.0';
      const version = '1.2.0';

      const actual = isLatestRelease(latestTag, version);
      expect(actual).toBe(true);
    });

    it('detects smaller new version', () => {
      const latestTag = '1.1.0';
      const version = '1.0.1';

      const actual = isLatestRelease(latestTag, version);
      expect(actual).toBe(false);
    });
  });
});
