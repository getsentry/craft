import { arch, hostname, platform, release, userInfo } from 'os';

import * as Sentry from '@sentry/node';

import { logger } from '../logger';
import { getPackageVersion } from './version';

/**
 * Initializes Sentry SDK if CRAFT_SENTRY_SDN is set
 */
export function initSentrySdk(): void {
  const sentryDsn = (process.env.CRAFT_SENTRY_DSN || '').trim();
  if (!sentryDsn.startsWith('http')) {
    logger.debug(
      'Not initializing Sentry SDK - no valid DSN found in environment or ' +
        'config files'
    );
    return;
  }

  logger.debug('Sentry DSN found in the environment, initializing the SDK');
  Sentry.init({ dsn: sentryDsn });

  Sentry.configureScope(scope => {
    scope.setTag('os-username', userInfo().username);
    scope.setTag('os-hostname', hostname());
    scope.setTag('os-platform', platform());
    scope.setTag('os-arch', arch());
    scope.setTag('os-release', release());

    scope.setExtra('argv', process.argv);
    scope.setExtra('craft-version', getPackageVersion());
    scope.setExtra('working-directory', process.cwd());
  });
}
