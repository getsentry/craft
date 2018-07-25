import chalk from 'chalk';
import consola = require('consola');
import { emojify } from 'node-emoji';
import { format } from 'util';

/**
 * Prepends the message with a prefix and formats its arguments.
 *
 * The message may be any object, which will be debug formatted in that case. If
 * the message contains a format string, its placeholders will be replaced with
 * the supplied arguments. Additional arguments will be printed after that,
 * separated with spaces.
 *
 * In case the resulting formatted message contains emoji placeholders, they
 * will be replaced with the actual emoji character.
 *
 * If the message is empty, then the prefix will be omitted an an empty line
 * will be rendered instead.
 *
 * @param prefix An optional prefix prepended to the message.
 * @param message A message-like object.
 * @returns The prepared message with interpolated arguments.
 */
function formatMessage(prefix: string, message?: any, ...args: any[]): any {
  if (message === undefined && args.length === 0) {
    return '';
  }

  let formatted: string;
  if (prefix === '') {
    formatted = format(message, ...args);
  } else if (typeof message === 'string') {
    formatted = format(`${prefix} ${message}`, ...args);
  } else {
    formatted = format(prefix, message, ...args);
  }

  return emojify(formatted);
}

/**
 * Logs a debug message to the output.
 *
 * @param message A message or formattable object to log.
 * @param args Further arguments to format into the message or log after.
 */
export function debug(message?: any, ...args: any[]): void {
  console.debug(formatMessage(chalk.dim('debug'), message, ...args));
}

/**
 * Logs an info message to the output.
 *
 * @param message A message or formattable object to log.
 * @param args Further arguments to format into the message or log after.
 */
export function info(message?: any, ...args: any[]): void {
  console.info(formatMessage(chalk.blueBright('info'), message, ...args));
}

/**
 * Logs a message with default level to the output.
 *
 * @param message A message or formattable object to log.
 * @param args Further arguments to format into the message or log after.
 */
export function log(message?: any, ...args: any[]): void {
  // tslint:disable-next-line:no-console
  console.log(formatMessage('', message, ...args));
}

/**
 * Logs a warning message to the output.
 *
 * @param message A message or formattable object to log.
 * @param args Further arguments to format into the message or log after.
 */
export function warn(message?: any, ...args: any[]): void {
  console.warn(formatMessage(chalk.yellow('warning'), message, ...args));
}

/**
 * Logs an error message to the output.
 *
 * @param message A message or formattable object to log.
 * @param args Further arguments to format into the message or log after.
 */
export function error(message?: any, ...args: any[]): void {
  console.error(formatMessage(chalk.red('error'), message, ...args));
}

/***************************************************************/
/**
 * Below: we module-export "consola" instance by default.
 */

// tslint:disable:object-literal-sort-keys
const LOG_LEVELS: { [key: string]: number } = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  SUCCESS: 3,
  DEBUG: 4,
  TRACE: 4,
};

/**
 * Read logging level from the environment
 */
function getLogLevel(): number {
  const logLevelName = process.env.CRAFT_LOG_LEVEL || '';
  const logLevelNumber = LOG_LEVELS[logLevelName.toUpperCase()];
  return logLevelNumber || consola.level;
}

consola.level = getLogLevel();

// tslint:disable-next-line:no-default-export
export default consola;
