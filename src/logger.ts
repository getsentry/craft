import { addBreadcrumb, Severity } from '@sentry/node';
import Table from 'cli-table';
import consola, {
  BasicReporter,
  ConsolaReporterLogObject,
  LogLevel,
} from 'consola';

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

export { LogLevel as LogLevel };

/** Reporter that sends logs to Sentry */
class SentryBreadcrumbReporter extends BasicReporter {
  public log(logObj: ConsolaReporterLogObject) {
    const breadcrumb = {
      message: this.formatLogObj(logObj),
      level: logObj.type as Severity,
    };
    addBreadcrumb(breadcrumb);
  }
}

export function setLevel(level: LogLevel): void {
  logger.level = level;
  // @ts-ignore We know _defaults exists, and this is the only way
  // to modify the default level after creation.
  logger._defaults.level = level;
  logger.resume();
}

export const logger = consola.create({});
// Pause until we set the logging level from helpers#setGlobals
// This allows us to enqueue debug logging even before we set the
// logging level. These are flushed as soon as we run `logger.resume()`.
logger.pause();
logger.addReporter(new SentryBreadcrumbReporter());
