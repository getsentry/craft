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
      items: { $ref: '#/definitions/targetConfig' },
    },
    preReleaseCommand: { type: 'string' },
    changelog: { type: 'string' },
    changelogPolicy: {
      title: 'ChangelogPolicy',
      description: 'Different policies for changelog management',
      type: 'string',
      enum: ['simple', 'none'],
      tsEnumNames: ['Simple', 'None'],
    },
    minVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+.*$',
    },
    requireNames: {
      type: 'array',
      items: { type: 'string' },
    },
    statusProvider: {
      title: 'BaseStatusProvider',
      description: 'Which service should be used for status checks',
      type: 'object',
      properties: {
        name: {
          title: 'StatusProviderName',
          description: 'Name of the status provider',
          type: 'string',
          enum: ['zeus', 'github'],
          tsEnumNames: ['Zeus', 'Github'],
        },
        config: {
          type: 'object',
        },
      },
      additionalProperties: false,
      required: ['name'],
    },
    artifactProvider: {
      title: 'BaseArtifactProvider',
      description: 'Which service should be used for artifact storage',
      type: 'object',
      properties: {
        name: {
          title: 'ArtifactProviderName',
          description: 'Name of the artifact provider',
          type: 'string',
          enum: ['zeus', 'gcs'],
          tsEnumNames: ['Zeus', 'GCS'],
        },
        config: {
          type: 'object',
        },
      },
      additionalProperties: false,
      required: ['name'],
    },
  },
  additionalProperties: false,
  required: ['github'],

  definitions: {
    targetConfig: {
      title: 'TargetConfig',
      description: 'Generic target configuration',
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
        includeNames: {
          type: 'string',
        },
        excludeNames: {
          type: 'string',
        },
      },
    },

    /**
     * FIXME: these definitions are NOT used at the moment.
     * Reason: referencing (extending) targetConfig definition results into
     * duplicated TargetConfig interfaces in the TS file.
     *
     * e.g.
     *
     * interface GithubTargetConfig extends TargetConfig {}
     *
     * and
     *
     * interface NpmTargetConfig extends TargetConfig1 {}
     *
     * ...where TargetConfig and TargetConfig1 have the same definition.
     *
     * Related GitHub tickets:
     * https://github.com/bcherny/json-schema-to-typescript/issues/142
     * https://github.com/bcherny/json-schema-to-typescript/issues/56
     * https://github.com/bcherny/json-schema-to-typescript/issues/132
     *
     */
    githubConfig: {
      title: 'GithubTargetConfig',
      description: 'Configuration options for the Github target',
      extends: { $ref: '#/definitions/targetConfig' },
      properties: {
        changelog: {
          type: 'string',
        },
        name: { type: 'string', enum: ['github'] },
      },
      required: ['name'],
      additionalProperties: false,
    },
    npmConfig: {
      title: 'NpmTargetConfig',
      description: 'Configuration options for the NPM target',
      extends: { $ref: '#/definitions/targetConfig' },
      properties: {
        access: {
          type: 'string',
        },
      },
      additionalProperties: false,
    },
  },
};

module.exports = projectConfigJsonSchema;
