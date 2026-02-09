import * as Sentry from '@sentry/node';

/** Inferred type from Sentry.startSpan's first parameter */
type StartSpanOptions = Parameters<typeof Sentry.startSpan>[0];

/**
 * Wraps a function with Sentry tracing
 *
 * @param fn Function to wrap
 * @param spanOptions Optional span configuration
 * @returns Wrapped function that creates a span when called
 */
export function withTracing<T extends (...args: any[]) => any>(
  fn: T,
  spanOptions: Partial<StartSpanOptions> = {},
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>): ReturnType<T> =>
    Sentry.startSpan(
      {
        name: fn.name || 'anonymous',
        attributes: { args: JSON.stringify(args) },
        ...spanOptions,
      },
      () => fn(...args),
    );
}
