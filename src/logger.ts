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
// tslint:disable: completed-docs
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

// tslint:disable-next-line: variable-name
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

function getLogLevelFromName(logLevel: keyof typeof LOG_LEVEL): LOG_LEVEL {
  if (logLevel in LOG_LEVEL) {
    return LOG_LEVEL[logLevel];
  } else {
    throw new Error(`Invalid log level: ${logLevel}`);
  }
}

/**
 * Read logging level from the environment
 */
function getLogLevelFromEnv(): LOG_LEVEL {
  const logLevelName = (process.env.CRAFT_LOG_LEVEL || '').toUpperCase();
  let logLevel;
  try {
    logLevel = getLogLevelFromName(logLevelName as keyof typeof LOG_LEVEL);
  } catch (err) {
    logLevel = consola.level;
  }
  return logLevel;
}

/**
 * Set log level to the given name
 * @param logLevel desired log level
 */
export function setLogLevel(logLevel: LOG_LEVEL): void {
  consola.level = logLevel;
}

/**
 * Initialize and return the logger
 * @param [logLevel] The desired logging level
 */
export function init(logLevel?: keyof typeof LOG_LEVEL): Logger {
  setLogLevel(
    logLevel !== undefined
      ? getLogLevelFromName(logLevel)
      : getLogLevelFromEnv()
  );
  consola.reporters.push(new SentryBreadcrumbReporter());
  return consola;
}

setLogLevel(getLogLevelFromEnv());

export { consola as logger };
