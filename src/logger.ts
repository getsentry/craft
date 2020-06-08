import { addBreadcrumb, Severity } from '@sentry/node';
import Table = require('cli-table');
import consola = require('consola');

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
/**
 * The available log levels
 */
export enum LOG_LEVEL {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  SUCCESS = 3,
  DEBUG = 4,
  TRACE = 4,
}

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
function getLogLevel(): LOG_LEVEL {
  const logLevelName = (process.env.CRAFT_LOG_LEVEL || '').toUpperCase();
  return LOG_LEVEL[logLevelName as keyof typeof LOG_LEVEL] || consola.level;
}

// tslint:disable-next-line: variable-name
export type Logger = typeof consola;

/**
 * Initialize and return the logger
 * @param [logLevel] The desired loggin level
 */
export function init(logLevel?: keyof typeof LOG_LEVEL): Logger {
  consola.level =
    logLevel !== undefined && logLevel in LOG_LEVEL
      ? LOG_LEVEL[logLevel]
      : getLogLevel();
  consola.reporters.push(new SentryBreadcrumbReporter());
  return consola;
}

export { consola as logger };
