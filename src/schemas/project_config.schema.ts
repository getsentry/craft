/**
 * We store JSON-schema for project configuration in the TS file, so it is
 * properly seen and copied by TS-compiler.
 */

// tslint:disable
const projectConfigJsonSchema = {
  title: 'CraftProjectConfig',
  description: 'Craft project-specific configuration',
  type: 'object',
  properties: {
    github: {
      title: 'GithubGlobalConfig',
      description: 'Global (non-target!) GitHub configuration for the project',
      type: 'object',
      properties: {
        owner: {
          type: 'string',
        },
        repo: {
          type: 'string',
        },
      },
      additionalProperties: false,
      required: ['owner', 'repo'],
    },
    targets: {
      type: 'array',
      items: {
        title: 'TargetConfig',
        description: 'Generic target configuration',
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
        },
      },
    },
  },
  additionalProperties: false,
  required: ['github'],
};

module.exports = projectConfigJsonSchema;
