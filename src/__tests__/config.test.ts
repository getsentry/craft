import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { compile } from 'json-schema-to-typescript';

import { getProjectConfigSchema, validateConfiguration } from '../config';

const configSchemaDir = join(dirname(__dirname), 'schemas');
const configGeneratedTypes = join(configSchemaDir, 'project_config.ts');

/**
 * We compile JSON schema to TypeScript interface as part of tests to compare
 * it with the existing file. This is done to be promptly notified about any
 * changes to the JSON schema that are not yet reflected in the TS interface.
 */
describe('compile-json-schema-to-typescript', () => {
  test('does not make any changes to the compiled interface', async () => {
    const projectConfig = require('../schemas/project_config.schema');
    const storedOutput = readFileSync(configGeneratedTypes, {
      encoding: 'utf8',
    });

    const generatedOutput = await compile(projectConfig, '');

    expect(generatedOutput).toBeTruthy();
    expect(generatedOutput).toBe(storedOutput);
  });
});

describe('validateConfiguration', () => {
  test('parses minimal configuration', async () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    const projectConfig = validateConfiguration(data);

    expect(projectConfig).toEqual(data);
  });

  test('fails with empty configuration', async () => {
    expect.assertions(1);

    try {
      validateConfiguration({});
    } catch (e) {
      expect(e.message).toMatch(/should have required property/i);
    }
  });
});

describe('getProjectConfigSchema', () => {
  test('returns non-empty object', async () => {
    const projectConfigSchema = getProjectConfigSchema();

    expect(projectConfigSchema).toBeTruthy();
    expect(projectConfigSchema).toHaveProperty('title');
    expect(projectConfigSchema).toHaveProperty('properties');
  });
});
