import * as fs from 'fs';

import { getGCSCredsFromEnv } from '../gcsApi';
import { withTempFile } from '../files';

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
