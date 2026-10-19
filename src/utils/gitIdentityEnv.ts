/**
 * Git identity variables needed for Craft-created commits.
 *
 * simple-git removes guarded `GIT_*` environment variables unless they are
 * explicitly allowed. Keep this list limited to author and committer identity
 * so other Git environment controls remain blocked.
 */
export const GIT_IDENTITY_ENV = [
  'EMAIL',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME',
] as const;
