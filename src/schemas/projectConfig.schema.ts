/**
 * We store JSON-schema for project configuration in the TS file, so it is
 * properly seen and copied by TS-compiler.
 */

const projectConfigJsonSchema = {
  title: 'CraftProjectConfig',
  description: 'Craft project-specific configuration',
  type: 'object',
  properties: {
    github: {
      title: 'GitHubGlobalConfig',
      description: 'Global (non-target!) GitHub configuration for the project',
      type: 'object',
      properties: {
        owner: {
          type: 'string',
        },
        repo: {
          type: 'string',
        },
        // TODO(byk): This is now obsolete, only in-place to keep bw compat
        //            deprecate and remove?
        projectPath: {
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
    postReleaseCommand: { type: 'string' },
    releaseBranchPrefix: { type: 'string' },
    changelog: {
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            policy: {
              type: 'string',
              enum: ['auto', 'simple', 'none'],
            },
            scopeGrouping: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      ],
    },
    changelogPolicy: {
      title: 'ChangelogPolicy',
      description:
        'DEPRECATED: Use changelog.policy instead. Different policies for changelog management',
      type: 'string',
      enum: ['auto', 'simple', 'none'],
      tsEnumNames: ['Auto', 'Simple', 'None'],
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
          enum: ['github'],
          tsEnumNames: ['GitHub'],
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
          enum: ['gcs', 'github', 'none'],
          tsEnumNames: ['GCS', 'GitHub', 'None'],
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

  definitions: {
    targetConfig: {
      title: 'TargetConfig',
      description: 'Generic target configuration',
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        includeNames: {
          type: 'string',
        },
        excludeNames: {
          type: 'string',
        },
      },
      required: ['name'],
    },

    /**
     * FIXME: these definitions are NOT used at the moment.
     * Reason: referencing (extending) targetConfig definition results into
     * duplicated TargetConfig interfaces in the TS file.
     *
     * e.g.
     *
     * interface GitHubTargetConfig extends TargetConfig {}
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
      title: 'GitHubTargetConfig',
      description: 'Configuration options for the GitHub target',
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
          description: 'NPM access level (public or restricted)',
        },
        checkPackageName: {
          type: 'string',
          description:
            'Package name to check for latest version on the registry',
        },
        workspaces: {
          type: 'boolean',
          description:
            'Enable workspace discovery to auto-generate npm targets for all workspace packages',
        },
        includeWorkspaces: {
          type: 'string',
          description:
            'Regex pattern to filter which workspace packages to include',
        },
        excludeWorkspaces: {
          type: 'string',
          description:
            'Regex pattern to filter which workspace packages to exclude',
        },
        artifactTemplate: {
          type: 'string',
          description:
            'Template for artifact filenames. Variables: {{name}}, {{simpleName}}, {{version}}',
        },
      },
      additionalProperties: false,
    },
    cratesConfig: {
      title: 'CratesTargetConfig',
      description: 'Configuration options for the Crates target',
      extends: { $ref: '#/definitions/targetConfig' },
      properties: {
        noDevDeps: {
          type: 'boolean',
        },
      },
      additionalProperties: false,
    },
  },
};

module.exports = projectConfigJsonSchema;
