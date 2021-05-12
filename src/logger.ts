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

export const logger = consola.create({});
// Pause until we set the logging level from helpers#setGlobals
// This allows us to enqueue debug logging even before we set the
// logging level. These are flushed as soon as we run `logger.resume()`.
logger.pause();
logger.addReporter(new SentryBreadcrumbReporter());
