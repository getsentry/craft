import * as fs from 'fs';
import * as path from 'path';

import {
  getGCSCredsFromEnv,
  CraftGCSClient,
  DEFAULT_UPLOAD_METADATA,
} from '../gcsApi';
import { withTempFile } from '../files';
import { RemoteArtifact } from '../../../dist/artifact_providers/base.d';

const cleanEnv = { ...process.env };

/**
 * Mocks for parts of the gcs client package, and for controling whether or not
 * we can find given files
 */

const mockGCSUpload = jest.fn();
const mockGCSDownload = jest.fn();
jest.mock('@google-cloud/storage', () => ({
  Bucket: jest.fn(() => ({
    file: jest.fn(() => ({ download: mockGCSDownload })),
    upload: mockGCSUpload,
  })),
  Storage: jest.fn(() => ({})),
}));

const syncExistsSpy = jest.spyOn(fs, 'existsSync');
// skip checking whether our fake files and directory exist - it doesn't matter,
// since we’re not actually going to attempt to do anything with them
syncExistsSpy.mockReturnValue(true);

/**
 * Client for testing, along with a few example artifacts
 */

const client = new CraftGCSClient({
  bucketName: 'captured-squirrels',
  credentials: {
    client_email: 'mighty_huntress@dogs.com',
    private_key: 'DoGsArEgReAtSoMeSeCrEtStUfFhErE',
  },
  projectId: 'squirrel-chasing',
});

const squirrelStatsArtifact: RemoteArtifact = {
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

const tempDownloadDirectory = './temp/';

const squirrelSimulatorArtifact: RemoteArtifact = {
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

/**
 * Finally, the tests themselves
 */

describe('gcsApi module', () => {
  afterEach(() => {
    // in case we've modified the env in any way, reset it
    process.env = { ...cleanEnv };

    // this clears out calls and results, but preserves mocked return values and
    // mocked implemenations
    jest.clearAllMocks();
  });

  describe('getGCSCredsFromEnv', () => {
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

    it('errors if given bogus JSON', () => {
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

      // make sure it won't find the file
      syncExistsSpy.mockReturnValueOnce(false);

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
    describe('upload', () => {
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
    }); // end describe('upload')

    describe('download', () => {
      it('calls the GCS library download method with the right parameters', async () => {
        expect.assertions(1);

        await client.downloadArtifact(
          squirrelStatsArtifact.storedFile.downloadFilepath,
          tempDownloadDirectory
        );

        const { filename } = squirrelStatsArtifact;

        expect(mockGCSDownload).toHaveBeenCalledWith({
          destination: path.join(tempDownloadDirectory, filename),
        });
      });

      it("errors if download directory doesn't exist", async () => {
        expect.assertions(1);

        // make sure it thinks it doesn't exist
        syncExistsSpy.mockReturnValueOnce(false);

        await expect(
          client.downloadArtifact(
            squirrelSimulatorArtifact.storedFile.downloadFilepath,
            './iDontExist/'
          )
        ).rejects.toThrowError(`directory does not exist!`);
      });

      it('errors if GCS download goes sideways', async () => {
        expect.assertions(1);

        mockGCSDownload.mockImplementation(() => {
          throw new Error('The squirrel got away!');
        });

        const { filename } = squirrelSimulatorArtifact;

        await expect(
          client.downloadArtifact(
            squirrelSimulatorArtifact.storedFile.downloadFilepath,
            tempDownloadDirectory
          )
        ).rejects.toThrowError(
          `Encountered an error while downloading \`${filename}\``
        );
      });

      it("doesn't upload anything in dry run mode", async () => {
        expect.assertions(1);

        process.env.DRY_RUN = 'true';

        await client.downloadArtifact(
          squirrelSimulatorArtifact.storedFile.downloadFilepath,
          tempDownloadDirectory
        );

        expect(mockGCSDownload).not.toHaveBeenCalled();
      });
    }); // end describe('download')
  }); // end describe('CraftGCSClient class')
}); // end describe('gcsApi module')
