/** Fixed diagnostics only: never log provider messages, source text or URLs. */
export type SummaryFailureReason =
  | 'configuration'
  | 'credential'
  | 'http'
  | 'network'
  | 'deadline'
  | 'response-size'
  | 'response-body'
  | 'response-envelope'
  | 'response-json'
  | 'response-schema'
  | 'coverage-missing-id'
  | 'coverage-child-id'
  | 'coverage-short-id'
  | 'coverage-unknown-id'
  | 'coverage-duplicate-id'
  | 'important-missing'
  | 'important-unknown'
  | 'important-duplicate'
  | 'unsafe-claim'
  | 'request-budget'
  | 'input-budget'
  | 'reduction-budget'
  | 'unexpected';

export class SummaryFailure extends Error {
  constructor(
    readonly reason: SummaryFailureReason,
    readonly stage?: string,
    readonly status?: number,
  ) {
    super(
      reason === 'http'
        ? `HTTP summary request failed (${status})`
        : `AI summary ${reason} failure`,
    );
  }
}

export function summaryFailureDiagnostic(error: unknown): string {
  const failure = error instanceof SummaryFailure ? error : undefined;
  const stage = ['scope', 'category', 'release'].includes(failure?.stage || '')
    ? failure!.stage
    : 'unknown';
  const status = failure?.status;
  return `stage=${stage}; reason=${failure?.reason || 'unexpected'}${
    Number.isInteger(status) && status! >= 100 && status! <= 599
      ? `; HTTP ${status}`
      : ''
  }`;
}
