import { hostname, userInfo } from 'os';

import * as Sentry from '@sentry/node';

import { logger } from '../logger';
import { getPackageVersion } from './version';

let sentryInitialized = false;

export async function initSentrySdk(): Promise<void> {
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
    scope.setExtra('argv', process.argv);
    scope.setTag('username', userInfo().username);
    scope.setTag('hostname', hostname());
    scope.setTag('craft-version', getPackageVersion());
  });

  sentryInitialized = true;
}

export function isSentryInitialized(): boolean {
  return sentryInitialized;
}

export function captureException(e: any): string | undefined {
  return sentryInitialized ? Sentry.captureException(e) : undefined;
}
