import { arch, hostname, platform, release, userInfo } from 'os';

import * as Sentry from '@sentry/node';

import { logger } from '../logger';
import { getPackageVersion } from './version';

let sentryInitialized = false;

/**
 * Initializes Sentry SDK if CRAFT_SENTRY_SDN is set
 */
export function initSentrySdk(): void {
  if (sentryInitialized) {
    return;
  }

  const sentryDsn = (process.env.CRAFT_SENTRY_DSN || '').trim();
  if (!sentryDsn.startsWith('http')) {
    logger.debug('Not initializing Sentry SDK');
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

  sentryInitialized = true;
}

/**
 * Returns "true" if Sentry SDK is initialized
 */
export function isSentryInitialized(): boolean {
  return sentryInitialized;
}

/**
 * Sends an exception to Sentry
 *
 * @param e Error (exception) object
 */
export function captureException(e: any): string | undefined {
  return sentryInitialized ? Sentry.captureException(e) : undefined;
}

/**
 * Records a breadcrumb to Sentry
 *
 * @param e Error (exception) object
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (sentryInitialized) {
    Sentry.addBreadcrumb(breadcrumb);
  }
}
