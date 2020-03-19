import * as fs from 'fs';

import { getGCSCredsFromEnv, CraftGCSClient } from '../gcsApi';
import { withTempFile } from '../files';

const mockGCSUpload = jest.fn();
jest.mock('@google-cloud/storage', () => ({
  Bucket: jest.fn(() => ({ upload: mockGCSUpload })),
  Storage: jest.fn(() => ({})),
}));

describe('getGCSCredsFromEnv', () => {
  const cleanEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...cleanEnv };
  });

  it('pulls JSON creds from env', () => {
    process.env.DOG_CREDS_JSON = `{
      "project_id": "squirrel-chasing",
      "private_key": "DoGsArEgReAtSoMeSeCrEtStUfFhErE",
      "client_email": "might_huntress@dogs.com",
      "other_stuff": "can be anything",
      "tail_wagging": "true",
      "barking": "also VERY true"
    }`;

    const { project_id, client_email, private_key } = getGCSCredsFromEnv(
      { name: 'DOG_CREDS_JSON' },
      { name: 'DOG_CREDS_PATH' }
    );

    expect(project_id).toEqual('squirrel-chasing');
    expect(client_email).toEqual('might_huntress@dogs.com');
    expect(private_key).toEqual('DoGsArEgReAtSoMeSeCrEtStUfFhErE');
  });

  it('pulls filepath creds from env', async () => {
    // ensure that the assertions below actually happen, since they in an async
    // function
    expect.assertions(3);

    await withTempFile(tempFilepath => {
      fs.writeFileSync(
        tempFilepath,
        `{
          "project_id": "squirrel-chasing",
          "private_key": "DoGsArEgReAtSoMeSeCrEtStUfFhErE",
          "client_email": "might_huntress@dogs.com",
          "other_stuff": "can be anything",
          "tail_wagging": "true",
          "barking": "also VERY true"
        }`
      );
      process.env.DOG_CREDS_PATH = tempFilepath;

      const { project_id, client_email, private_key } = getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );

      expect(project_id).toEqual('squirrel-chasing');
      expect(client_email).toEqual('might_huntress@dogs.com');
      expect(private_key).toEqual('DoGsArEgReAtSoMeSeCrEtStUfFhErE');
    });
  });

  it('errors if neither JSON creds nor creds filepath provided', () => {
    // skip defining variables

    expect(() => {
      getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );
    }).toThrowError('GCS credentials not found!');
  });

  it('errors given bogus JSON', () => {
    process.env.DOG_CREDS_JSON = `Dogs!`;

    expect(() => {
      getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );
    }).toThrowError('Error parsing JSON credentials');
  });

  it('errors if creds file missing from given path', () => {
    process.env.DOG_CREDS_PATH = './iDontExist.json';

    expect(() => {
      getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );
    }).toThrowError('File does not exist: `./iDontExist.json`!');
  });

  it('errors if necessary field missing', () => {
    process.env.DOG_CREDS_JSON = `{
      "project_id": "squirrel-chasing",
      "private_key": "DoGsArEgReAtSoMeSeCrEtStUfFhErE"
    }`;

    expect(() => {
      getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );
    }).toThrowError('GCS credentials missing `client_email`!');
  });
}); // end describe('getGCSCredsFromEnv')

describe('CraftGCSClient class', () => {
  const client = new CraftGCSClient({
    bucketName: 'captured-squirrels',
    credentials: {
      client_email: 'might_huntress@dogs.com',
      private_key: 'DoGsArEgReAtSoMeSeCrEtStUfFhErE',
    },
    projectId: 'squirrel-chasing',
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('calls the GCS library upload method with the right parameters', async () => {
    await client.uploadArtifacts(['./dist/someFile'], {
      path: '/some/destination/spot/',
    });

    expect(mockGCSUpload).toHaveBeenCalledWith('./dist/someFile', {
      // contentType: 'application/javascript; charset=utf-8',
      destination: '/some/destination/spot/someFile',
      gzip: true,
      metadata: { cacheControl: `public, max-age=300` },
    });
  });

  it('detects content type correctly', async () => {
    await client.uploadArtifacts(['./dist/bundle.js'], {
      path: '/some/destination/spot/',
    });

    expect(mockGCSUpload).toHaveBeenCalledWith(
      './dist/bundle.js',
      expect.objectContaining({
        contentType: 'application/javascript; charset=utf-8',
      })
    );
  });

  it('errors if destination path not specified', async () => {
    await expect(
      client.uploadArtifacts(['./dogs'], undefined as any)
    ).rejects.toThrowError('no destination path specified!');

    await expect(
      client.uploadArtifacts(['./dogs'], {
        path: undefined,
      } as any)
    ).rejects.toThrowError('no destination path specified!');
  });

  it('errors if GCS upload goes sideways', async () => {
    mockGCSUpload.mockImplementation(() => {
      throw new Error('whoops');
    });

    await expect(
      client.uploadArtifacts(['./dist/someFile'], {
        path: '/some/destination/spot/',
      })
    ).rejects.toThrowError(
      'Error uploading `someFile` to `/some/destination/spot/someFile`'
    );
  });
}); // end describe('CraftGCSClient class')
