import chalk from 'chalk';
import { format } from 'util';

/**
 * Prepends the message with a prefix and formats its arguments.
 *
 * The message may be any object, which will be debug formatted in that case. If
 * the message contains a format string, its placeholders will be replaced with
 * the supplied arguments. Additional arguments will be printed after that,
 * separated with spaces.
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

  if (prefix === '') {
    return format(message, ...args);
  } else if (typeof message === 'string') {
    return format(`${prefix} ${message}`, ...args);
  } else {
    return format(prefix, message, ...args);
  }
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
