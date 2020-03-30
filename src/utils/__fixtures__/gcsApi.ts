import { RemoteArtifact } from '../../artifact_providers/base';

export const squirrelBucket = 'squirrel-chasing';

export const gcsCredsJSON = JSON.stringify({
  // tslint:disable: object-literal-sort-keys
  project_id: 'o-u-t-s-i-d-e',
  private_key: 'DoGsArEgReAtSoMeSeCrEtStUfFhErE',
  client_email: 'might_huntress@dogs.com',
  other_stuff: 'can be anything',
  tail_wagging: 'true',
  barking: 'also VERY true',
});

export const squirrelStatsArtifact: RemoteArtifact = {
  filename: 'march-2020-stats.csv',
  mimeType: 'text/csv',
  storedFile: {
    downloadFilepath: 'captured-squirrels/march-2020-stats.csv',
    filename: 'march-2020-stats.csv',
    lastUpdated: '2020-03-30T19:14:44.694Z',
    size: 112112,
  },
};

export const squirrelStatsLocalPath = './temp/march-2020-stats.csv';

export const squirrelStatsBucketPath = {
  path: '/stats/2020/',
};

export const squirrelSimulatorArtifact: RemoteArtifact = {
  filename: 'bundle.js',
  mimeType: 'application/json',
  storedFile: {
    downloadFilepath: 'squirrel-simulator/bundle.js',
    filename: 'bundle.js',
    lastUpdated: '2020-03-30T19:14:44.694Z',
    size: 123112,
  },
};

export const squirrelSimulatorLocalPath = './dist/bundle.js';

export const squirrelSimulatorBucketPath = {
  path: '/simulator/v1.12.1/dist/',
  metadata: { cacheControl: `public, max-age=3600` },
};

export {
  squirrelSimulatorGCSFileObj,
  squirrelStatsGCSFileObj,
} from './gcsFileObj';

export const tempDownloadDirectory = './temp/';
