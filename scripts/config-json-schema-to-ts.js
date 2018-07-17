/**
 * Convert JSON schema for project configuration to a set of TypeScript interfaces
 */
const fs = require('fs');
const json2ts = require('json-schema-to-typescript');

process.chdir(__dirname);

const jsonInputPath = '../src/schemas/project_config.schema.ts';
const tsOutputPath = '../src/schemas/project_config.ts';

const schema = require(jsonInputPath);
json2ts.compile(schema, '').then(ts => fs.writeFileSync(tsOutputPath, ts));
