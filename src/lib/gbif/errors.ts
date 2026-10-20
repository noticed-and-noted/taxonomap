/** GBIF could not be reached (after retries) and no cached copy exists. */
export class GbifUnavailableError extends Error {
  override readonly name: string = 'GbifUnavailableError';
  constructor(
    readonly url: string,
    readonly status?: number,
  ) {
    super(`GBIF unavailable (${status ?? 'network'})`);
  }
}

/** The request itself was rejected (4xx other than 429). Not retried. */
export class GbifRequestError extends Error {
  override readonly name: string = 'GbifRequestError';
  constructor(
    readonly url: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`GBIF rejected request (${status})`);
  }
}

/** GBIF answered 404: the thing asked for does not exist. */
export class GbifNotFoundError extends GbifRequestError {
  override readonly name: string = 'GbifNotFoundError';
}

export type UiErrorKind = 'unavailable' | 'not-found' | 'bad-request' | 'unknown';

/** Map any thrown value to a UI-safe category. Never surface raw messages. */
export function classifyError(error: unknown): UiErrorKind {
  if (error instanceof GbifNotFoundError) return 'not-found';
  if (error instanceof GbifRequestError) return 'bad-request';
  if (error instanceof GbifUnavailableError) return 'unavailable';
  return 'unknown';
}
