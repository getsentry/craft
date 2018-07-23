import { Artifact, Status } from '@zeus-ci/sdk';

import { ZeusStore } from '../zeus';

describe('filterArtifactsForRevision', () => {
  function artifactFactory(name: string): Artifact {
    return {
      download_url: 'http://invalid',
      id: name,
      name,
      status: Status.FINISHED,
      type: 'test/test',
    };
  }

  const zeusStore = new ZeusStore('craft-test', 'craft-test');
  const artifactList = ['test1.zip', 'test2.exe', 'test3.tgz', 'smthelse'].map(
    artifactFactory
  );
  zeusStore.listArtifactsForRevision = jest.fn(_revision => artifactList);
  const revision = '1234567';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not change the list if no arguments provided', async () => {
    const filtered = await zeusStore.filterArtifactsForRevision(revision);

    expect(filtered).toBe(artifactList);
  });

  test('uses includeNames', async () => {
    const filtered = await zeusStore.filterArtifactsForRevision(revision, {
      includeNames: /.exe$/,
    });

    expect(filtered).toEqual([artifactFactory('test2.exe')]);
  });

  test('uses excludeNames', async () => {
    const filtered = await zeusStore.filterArtifactsForRevision(revision, {
      excludeNames: /^test.*$/,
    });

    expect(filtered).toEqual([artifactFactory('smthelse')]);
  });

  test('uses both includeNames and excludeNames', async () => {
    const filtered = await zeusStore.filterArtifactsForRevision(revision, {
      excludeNames: /(exe|zip)$/,
      includeNames: /^test/,
    });

    expect(filtered).toEqual([artifactFactory('test3.tgz')]);
  });
});
