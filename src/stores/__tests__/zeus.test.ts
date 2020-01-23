import { Artifact, Status } from '@zeus-ci/sdk';

import { ZeusStore } from '../zeus';

function artifactFactory(name: string, options?: object): Artifact {
  return {
    download_url: 'http://invalid',
    file: {
      name: 'test',
      size: 100,
    },
    id: name,
    name,
    status: Status.FINISHED,
    type: 'test/test',
    ...options,
  };
}

const REPO_OWNER = 'craft-test-owner';
const REPO_NAME = 'craft-test';

describe('filterArtifactsForRevision', () => {
  const zeusStore = new ZeusStore(REPO_OWNER, REPO_NAME);
  const artifactList = [
    'test1.zip',
    'test2.exe',
    'test3.tgz',
    'smthelse',
  ].map(name => artifactFactory(name, undefined));
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

describe('filterArtifactsForRevision', () => {
  const zeusStore = new ZeusStore(REPO_OWNER, REPO_NAME);
  const artifactList = [
    'test1.zip',
    'test2.exe',
    'test3.tgz',
    'smthelse',
  ].map(name => artifactFactory(name, undefined));
  zeusStore.client.listArtifactsForRevision = jest
    .fn()
    .mockReturnValue(artifactList);
  const mockClientListArtifacts = zeusStore.client
    .listArtifactsForRevision as jest.Mock;
  const revision = '1234567';

  beforeEach(() => {
    jest.clearAllMocks();
    zeusStore.clearStoreCaches();
  });

  test('calls Zeus client with proper arguments', async () => {
    const result = await zeusStore.listArtifactsForRevision(revision);

    expect(result).toEqual(artifactList);
    expect(mockClientListArtifacts).toBeCalledWith(
      REPO_OWNER,
      REPO_NAME,
      revision
    );
  });

  test('caches results', async () => {
    const result1 = await zeusStore.listArtifactsForRevision(revision);
    const result2 = await zeusStore.listArtifactsForRevision(revision);

    expect(result1).toBe(result2);
    expect(mockClientListArtifacts).toHaveBeenCalledTimes(1);
  });

  test('picks only the most recent artifact in case there are duplicated names', async () => {
    const name = 'file.zip';
    const artifacts = [
      artifactFactory(name, {
        id: '1',
        updated_at: '2018-01-01T00:00:10.000000+00:00',
      }),
      artifactFactory(name, {
        id: '2',
        updated_at: '2018-11-11T00:55:55.999999+00:00',
      }),
      artifactFactory(name, {
        id: '3',
        updated_at: 'invalid',
      }),
    ];
    mockClientListArtifacts.mockReturnValue(artifacts);

    const result = await zeusStore.listArtifactsForRevision(revision);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(artifacts[1]);
  });
});
