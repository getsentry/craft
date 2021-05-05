/**
 * Tests of our ability to read craft config files. (This is NOT general test
 * configuration).
 */

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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const projectConfig = require('../schemas/projectConfig.schema');
    const storedOutput = readFileSync(configGeneratedTypes, {
      encoding: 'utf8',
    });
    const compileOptions = {
      style: { singleQuote: true, trailingComma: 'es5' } as any,
    };
    const generatedOutput = await compile(projectConfig, '', compileOptions);

    expect(generatedOutput).toBeTruthy();
    expect(generatedOutput).toBe(storedOutput);
  });
});

describe('validateConfiguration', () => {
  test('parses minimal configuration', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('fails with bad configuration', () => {
    expect(() => validateConfiguration({ zoom: 1 }))
      .toThrowErrorMatchingInlineSnapshot(`
      "Cannot parse configuration file:
      data should NOT have additional properties"
    `);
  });
});

describe('getProjectConfigSchema', () => {
  test('returns non-empty object', () => {
    const projectConfigSchema = getProjectConfigSchema();

    expect(projectConfigSchema).toHaveProperty('title');
    expect(projectConfigSchema).toHaveProperty('properties');
  });
});
