/**
 * Convert JSON schema for project configuration to a set of TypeScript interfaces
 */
const fs = require("fs");
const json2ts = require("json-schema-to-typescript");

process.chdir(__dirname);

const jsonInputPath = "../src/schemas/projectConfig.schema.ts";
const tsOutputPath = "../src/schemas/project_config.ts";

// FIXME Duplicates compilation options in config.test.ts
const compileOptions = { style: { singleQuote: true, trailingComma: "es5" } };

const schema = require(jsonInputPath);
json2ts
  .compile(schema, "", compileOptions)
  .then((ts) => fs.writeFileSync(tsOutputPath, ts))
  .catch((e) => console.error(e));
