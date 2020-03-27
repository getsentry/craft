import * as fs from 'fs';

import {
  getGCSCredsFromEnv,
  CraftGCSClient,
  DEFAULT_UPLOAD_METADATA,
} from '../gcsApi';
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
      client_email: 'mighty_huntress@dogs.com',
      private_key: 'DoGsArEgReAtSoMeSeCrEtStUfFhErE',
    },
    projectId: 'squirrel-chasing',
  });

  const squirrelStatsArtifact = {
    // tslint:disable: object-literal-sort-keys
    filename: 'march-squirrel-stats.csv',
    storedFile: {
      downloadFilepath: 'squirrel-chasing/march-2020-squirrel-stats.csv',
      filename: 'march-2020-squirrel-stats.csv',
      size: 1231,
    },
  };

  const squirrelStatsLocalPath = './temp/march-squirrel-stats.csv';

  const squirrelStatsBucketPath = {
    path: '/stats/2020/',
  };

  const squirrelSimulatorArtifact = {
    // tslint:disable: object-literal-sort-keys
    filename: 'bundle.js',
    storedFile: {
      downloadFilepath: 'squirrel-chasing/squirrel-simulator-bundle.js',
      filename: 'squirrel-simulator-bundle.js',
      size: 123112,
    },
  };

  const squirrelSimulatorLocalPath = './dist/bundle.js';

  const squirrelSimulatorBucketPath = {
    path: '/simulator/v1.12.1/dist/',
    metadata: { cacheControl: `public, max-age=3600` },
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('calls the GCS library upload method with the right parameters', async () => {
    await client.uploadArtifact(
      squirrelStatsLocalPath,
      squirrelStatsBucketPath
    );

    const { filename } = squirrelStatsArtifact;
    const { path: destinationPath } = squirrelStatsBucketPath;

    expect(mockGCSUpload).toHaveBeenCalledWith(squirrelStatsLocalPath, {
      destination: `${destinationPath}${filename}`,
      gzip: true,
      metadata: DEFAULT_UPLOAD_METADATA,
    });
  });

  it('detects content type correctly for JS and map files', async () => {
    await client.uploadArtifact(
      squirrelSimulatorLocalPath,
      squirrelSimulatorBucketPath
    );

    expect(mockGCSUpload).toHaveBeenCalledWith(
      squirrelSimulatorLocalPath,
      expect.objectContaining({
        contentType: 'application/javascript; charset=utf-8',
      })
    );
  });

  it('allows overriding of default metadata', async () => {
    await client.uploadArtifact(
      squirrelSimulatorLocalPath,
      squirrelSimulatorBucketPath
    );

    const { metadata } = squirrelSimulatorBucketPath;

    expect(mockGCSUpload).toHaveBeenCalledWith(
      squirrelSimulatorLocalPath,
      expect.objectContaining({
        metadata,
      })
    );
  });

  it('errors if GCS upload goes sideways', async () => {
    mockGCSUpload.mockImplementation(() => {
      throw new Error('The squirrel got away!');
    });

    const { filename } = squirrelSimulatorArtifact;

    await expect(
      client.uploadArtifact(
        squirrelSimulatorLocalPath,
        squirrelSimulatorBucketPath
      )
    ).rejects.toThrowError(
      `Encountered an error while uploading \`${filename}\``
    );
  });

  it("doesn't upload anything in dry run mode", async () => {
    process.env.DRY_RUN = 'true';

    await client.uploadArtifact(
      squirrelStatsLocalPath,
      squirrelStatsBucketPath
    );

    expect(mockGCSUpload).not.toHaveBeenCalled();
  });
}); // end describe('CraftGCSClient class')
