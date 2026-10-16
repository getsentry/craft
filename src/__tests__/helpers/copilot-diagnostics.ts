// Test-only diagnostics: production provider errors must not expose responses.
export async function describeCopilotRejection(
  response: Response,
  credential: string,
): Promise<string> {
  const omitted = `HTTP ${response.status}; rejection body omitted`;
  const reader = response.body?.getReader();
  if (!reader) return omitted;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic timeout')), 5000);
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      // Omit oversized bodies entirely, including any partial credential.
      if (bytes > 32 * 1024) return omitted;
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const fields = {
      message: body?.message,
      code: body?.code,
      error: typeof body?.error === 'string' ? body.error : undefined,
      errorMessage: body?.error?.message,
      errorCode: body?.error?.code,
      errorType: body?.error?.type,
    };
    const redact = (text: string) =>
      (credential ? text.split(credential).join('[redacted]') : text)
        .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, '[redacted]')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
    const details = Object.fromEntries(
      Object.entries(fields)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
        .map(([key, value]) => [key, redact(value)]),
    );
    if (!Object.keys(details).length) return omitted;
    // Serialize before truncation so control characters cannot become log commands.
    return `HTTP ${response.status}; ${JSON.stringify(details).slice(0, 2000)}`;
  } catch {
    return omitted;
  } finally {
    clearTimeout(timer);
    // Do not let a stalled server's cancel promise obscure the HTTP failure.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
