import { addBreadcrumb, Severity } from '@sentry/node';
import Table = require('cli-table');
import consola = require('consola');

/**
 * Format a list as a table
 *
 * @param options Options that are passed to cli-table constructor
 * @param values A list (of lists) of values
 */
export function formatTable(
  options: Record<string, any>,
  values: any[]
): string {
  const table = new Table(options);
  table.push(...values);
  return table.toString();
}

/***************************************************************/
/**
 * Below: we module-export "consola" instance by default.
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

export type Logger = typeof consola;

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
 * Read logging level from the environment and return the appropriate enum value
 */
function getLogLevelFromEnv(): LOG_LEVEL {
  const logLevelName = (process.env.CRAFT_LOG_LEVEL || '').toUpperCase();
  const logLevelNumber = LOG_LEVEL[logLevelName as keyof typeof LOG_LEVEL];
  return logLevelNumber ?? consola.level;
}

/**
 * Set log level to the given level
 * @param logLevel desired log level
 */
export function setLogLevel(logLevel: LOG_LEVEL): void {
  consola.level = logLevel;
}

let initialized = false;

/**
 * Initialize and return the logger
 * @param [logLevel] The desired logging level
 */
export function init(logLevel?: LOG_LEVEL): Logger {
  if (initialized) {
    consola.warn('Logger already initialized, ignoring duplicate init.');
  }

  setLogLevel(logLevel !== undefined ? logLevel : getLogLevelFromEnv());
  consola.reporters.push(new SentryBreadcrumbReporter());
  initialized = true;
  return consola;
}

setLogLevel(getLogLevelFromEnv());

export { consola as logger };
