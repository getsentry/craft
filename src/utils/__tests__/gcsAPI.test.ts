import * as fs from 'fs';
import * as path from 'path';

import {
  getGCSCredsFromEnv,
  CraftGCSClient,
  DEFAULT_UPLOAD_METADATA,
} from '../gcsApi';
import { withTempFile, withTempDir } from '../files';

import {
  dogsGHOrg,
  gcsCredsJSON,
  squirrelBucket,
  squirrelStatsLocalPath,
  squirrelStatsBucketPath,
  squirrelStatsArtifact,
  squirrelSimulatorLocalPath,
  squirrelSimulatorBucketPath,
  squirrelSimulatorArtifact,
  squirrelRepo,
  squirrelSimulatorCommit,
  squirrelStatsGCSFileObj,
  squirrelStatsCommit,
  squirrelSimulatorGCSFileObj,
} from '../__fixtures__/gcsApi';

/*************** mocks and other setup ***************/

jest.mock('../../logger');

const mockGCSUpload = jest.fn();
const mockGCSDownload = jest.fn();
const mockGCSGetFiles = jest.fn();
jest.mock('@google-cloud/storage', () => ({
  Bucket: jest.fn(() => ({
    file: jest.fn(() => ({ download: mockGCSDownload })),
    getFiles: mockGCSGetFiles,
    upload: mockGCSUpload,
  })),
  Storage: jest.fn(() => ({})),
}));

const syncExistsSpy = jest.spyOn(fs, 'existsSync');

const cleanEnv = { ...process.env };

const client = new CraftGCSClient({
  bucketName: squirrelBucket,
  credentials: {
    client_email: 'mighty_huntress@dogs.com',
    private_key: 'DoGsArEgReAtSoMeSeCrEtStUfFhErE',
  },
  projectId: 'o-u-t-s-i-d-e',
});

/*************** the actual tests ***************/

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
      process.env.DOG_CREDS_JSON = gcsCredsJSON;

      const { project_id, client_email, private_key } = getGCSCredsFromEnv(
        { name: 'DOG_CREDS_JSON' },
        { name: 'DOG_CREDS_PATH' }
      );

      expect(project_id).toEqual('o-u-t-s-i-d-e');
      expect(client_email).toEqual('might_huntress@dogs.com');
      expect(private_key).toEqual('DoGsArEgReAtSoMeSeCrEtStUfFhErE');
    });

    it('pulls filepath creds from env', async () => {
      // ensure that the assertions below actually happen, since they in an async
      // function
      expect.assertions(3);

      await withTempFile(tempFilepath => {
        fs.writeFileSync(tempFilepath, gcsCredsJSON);
        process.env.DOG_CREDS_PATH = tempFilepath;

        const { project_id, client_email, private_key } = getGCSCredsFromEnv(
          { name: 'DOG_CREDS_JSON' },
          { name: 'DOG_CREDS_PATH' }
        );

        expect(project_id).toEqual('o-u-t-s-i-d-e');
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
        "project_id": "o-u-t-s-i-d-e",
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
            metadata: expect.objectContaining({
              contentType: 'application/javascript; charset=utf-8',
            }),
          })
        );
      });

      it('allows overriding of default metadata', async () => {
        await client.uploadArtifact(
          squirrelSimulatorLocalPath,
          squirrelSimulatorBucketPath
        );

        const squirrelSimulatorMetadata = squirrelSimulatorBucketPath.metadata;

        expect(mockGCSUpload).toHaveBeenCalledWith(
          squirrelSimulatorLocalPath,
          expect.objectContaining({
            metadata: expect.objectContaining({ ...squirrelSimulatorMetadata }),
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

        await withTempDir(async tempDownloadDirectory => {
          await client.downloadArtifact(
            squirrelStatsArtifact.storedFile.downloadFilepath,
            tempDownloadDirectory
          );

          const { filename } = squirrelStatsArtifact;

          expect(mockGCSDownload).toHaveBeenCalledWith({
            destination: path.join(tempDownloadDirectory, filename),
          });
        });
      });

      it("errors if download directory doesn't exist", async () => {
        expect.assertions(1);

        // make sure it won't find the directory
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

        await withTempDir(async tempDownloadDirectory => {
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
      });

      it("doesn't upload anything in dry run mode", async () => {
        await withTempDir(async tempDownloadDirectory => {
          expect.assertions(1);

          process.env.DRY_RUN = 'true';

          await client.downloadArtifact(
            squirrelSimulatorArtifact.storedFile.downloadFilepath,
            tempDownloadDirectory
          );

          expect(mockGCSDownload).not.toHaveBeenCalled();
        });
      });
    }); // end describe('download')

    describe('listArtifactsForRevision', () => {
      it('calls the GCS library getFiles method with the right parameters', async () => {
        expect.assertions(1);

        mockGCSGetFiles.mockReturnValue([[]]);

        await client.listArtifactsForRevision(
          dogsGHOrg,
          squirrelRepo,
          squirrelSimulatorCommit
        );

        expect(mockGCSGetFiles).toHaveBeenCalledWith({
          prefix: path.join(dogsGHOrg, squirrelRepo, squirrelSimulatorCommit),
        });
      });

      it('converts GCSFile objects in response to RemoteArtifact objects', async () => {
        expect.assertions(1);

        mockGCSGetFiles.mockReturnValue([[squirrelStatsGCSFileObj]]);

        const artifacts = await client.listArtifactsForRevision(
          dogsGHOrg,
          squirrelRepo,
          squirrelStatsCommit
        );

        expect(artifacts[0]).toEqual(squirrelStatsArtifact);
      });

      it("returns all the results it's given by GCS", async () => {
        expect.assertions(1);

        mockGCSGetFiles.mockReturnValue([
          [squirrelStatsGCSFileObj, squirrelSimulatorGCSFileObj],
        ]);

        const artifacts = await client.listArtifactsForRevision(
          dogsGHOrg,
          squirrelRepo,
          squirrelStatsCommit
        );

        expect(artifacts.length).toEqual(2);
      });

      it('errors if GCS file listing goes sideways', async () => {
        expect.assertions(1);

        mockGCSGetFiles.mockImplementation(() => {
          throw new Error('The squirrel got away!');
        });

        await expect(
          client.listArtifactsForRevision(
            dogsGHOrg,
            squirrelRepo,
            squirrelSimulatorCommit
          )
        ).rejects.toThrowError('Error retrieving artifact list from GCS');
      });
    }); // end describe('listArtifactsForRevision')
  }); // end describe('CraftGCSClient class')
}); // end describe('gcsApi module')
