import { addBreadcrumb, SeverityLevel } from '@sentry/node';
import Table from 'cli-table';
import consola, {
  BasicReporter,
  Consola,
  ConsolaReporterLogObject,
  LogLevel,
} from 'consola';

/** Reporter that writes all output to stderr (so JSON on stdout isn't polluted) */
class StderrReporter extends BasicReporter {
  public log(logObj: ConsolaReporterLogObject) {
    const output = this.formatLogObj(logObj);
    process.stderr.write(output + '\n');
  }
}

// Redirect all console output to stderr so it doesn't interfere with JSON output on stdout
consola.setReporters([new StderrReporter()]);

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

/** Reporter that sends logs to Sentry */
class SentryBreadcrumbReporter extends BasicReporter {
  public log(logObj: ConsolaReporterLogObject) {
    const breadcrumb = {
      message: this.formatLogObj(logObj),
      level: logObj.type as SeverityLevel,
    };
    addBreadcrumb(breadcrumb);
  }
}

export { LogLevel as LogLevel };
const loggers: Consola[] = [];
function createLogger(tag?: string) {
  const loggerInstance = consola.withDefaults({ tag });
  loggerInstance.addReporter(new SentryBreadcrumbReporter());
  loggerInstance.withScope = createLogger;
  loggers.push(loggerInstance);
  return loggerInstance;
}

export const logger = createLogger();
// Pause until we set the logging level from helpers#setGlobals
// This allows us to enqueue debug logging even before we set the
// logging level. These are flushed as soon as we run `logger.resume()`.
logger.pause();

export function setLevel(logLevel: LogLevel): void {
  consola.level = logLevel;
  for (const loggerInstance of loggers) {
    loggerInstance.level = logLevel;
    loggerInstance.resume();
  }
}
