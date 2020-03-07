import { Severity } from '@sentry/node';
import Table = require('cli-table');
import consola = require('consola');

import { addBreadcrumb } from './utils/sentry';

/**
 * Format a list as a table
 *
 * @param options Options that are passed to cli-table constructor
 * @param values A list (of lists) of values
 */
export function formatTable(options: any, values: any[]): string {
  const table = new Table(options);
  table.push(...values);
  return table.toString();
}

/***************************************************************/
/**
 * Below: we module-export "consola" instance by default.
 */

// tslint:disable:object-literal-sort-keys
export const LOG_LEVELS: { [key: string]: number } = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  SUCCESS: 3,
  DEBUG: 4,
  TRACE: 4,
};

/** Log entry as passed to consola reporters */
interface LogEntry {
  /** Entry type */
  type: string;
  /** Creation date */
  date: string;
  /** Message */
  message: string;
  /** Additional message (e.g. if more than one line) */
  additional: string;
}

/** Reporter that sends logs to Sentry */
class SentryBreadcrumbReporter {
  /** Hook point for handling log entries */
  public log(logEntry: LogEntry): void {
    const breadcrumb = {
      message: `${logEntry.message}\n${logEntry.additional}`,
      level: logEntry.type as Severity,
    };
    addBreadcrumb(breadcrumb);
  }
}

/**
 * Read logging level from the environment
 */
function getLogLevel(): number {
  const logLevelName = process.env.CRAFT_LOG_LEVEL || '';
  const logLevelNumber = LOG_LEVELS[logLevelName.toUpperCase()];
  return logLevelNumber || consola.level;
}

consola.level = getLogLevel();
consola.reporters.push(new SentryBreadcrumbReporter());

export { consola as logger };
