import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { compileFromFile } from 'json-schema-to-typescript';

/**
 * We compile JSON schema to TypeScript interface as part of tests to compare
 * it with the existing file. This is done to be promptly notified about any
 * changes to the JSON schema that are not yet reflected in the TS interface.
 */
describe('compile-schema', () => {
  const configSchemaDir = join(dirname(__dirname), 'schemas');
  const configSchemaJson = join(configSchemaDir, 'project_config.json');
  const configGeneratedTypes = join(configSchemaDir, 'project_config.ts');

  test('does not make any changes to the compiled interface', async () => {
    const generatedOutput = await compileFromFile(configSchemaJson);
    const storedOutput = readFileSync(configGeneratedTypes, {
      encoding: 'utf8',
    });
    expect(generatedOutput).toBeTruthy();
    expect(generatedOutput).toBe(storedOutput);
  });
});
