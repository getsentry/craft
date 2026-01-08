import { arch, hostname, platform, release, userInfo } from 'os';
import { init } from '@sentry/node';
import isCI from 'is-ci';
import { getPackageVersion } from './utils/version';

// Detect CI environment at runtime
const isCIEnv = isCI || process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

const sentry = init({
  dsn: 'https://965f09d9d64681174a6617b1e11d7572@o1.ingest.us.sentry.io/4510674351620096',
  environment: isCIEnv ? 'github-ci' : process.env.NODE_ENV || 'development',
  release: `craft@${getPackageVersion()}`,
  tracesSampleRate: 1,
  debug: Boolean(process.env.SENTRY_DEBUG),

  beforeSendTransaction: event => {
    event.server_name = undefined; // Server name might contain PII
    return event;
  },

  beforeSend: event => {
    const exceptions = event.exception?.values;
    if (!exceptions) {
      return event;
    }
    for (const exception of exceptions) {
      if (!exception.stacktrace || !exception.stacktrace.frames) {
        continue;
      }

      for (const frame of exception.stacktrace.frames) {
        if (!frame.filename) {
          continue;
        }

        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (homeDir) {
          frame.filename = frame.filename?.replace(homeDir, '~');
        }
      }
    }

    event.server_name = undefined; // Server name might contain PII
    return event;
  },
});

if (sentry) {
  const scope = sentry.getCurrentScope();
  scope.setTag('os-username', userInfo().username);
  scope.setTag('os-hostname', hostname());
  scope.setTag('os-platform', platform());
  scope.setTag('os-arch', arch());
  scope.setTag('os-release', release());

  scope.setExtra('argv', process.argv);
  scope.setExtra('craft-version', getPackageVersion());
  scope.setExtra('working-directory', process.cwd());

  function shutdown() {
    sentry.close();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
