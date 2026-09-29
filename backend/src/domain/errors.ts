/**
 * Domain-level failures. The HTTP layer is the only place that knows these map to status
 * codes; the domain and application layers only ever throw these.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input violated an invariant (out-of-range value, malformed project, ...). */
export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message, 'VALIDATION_ERROR');
  }
}

/** A referenced audio asset does not exist (or expired out of the store). */
export class AssetNotFoundError extends DomainError {
  constructor(assetId: string) {
    super(`Audio asset "${assetId}" was not found or has expired.`, 'ASSET_NOT_FOUND');
  }
}

/** The uploaded bytes could not be decoded into PCM. */
export class AudioDecodeError extends DomainError {
  constructor(message: string) {
    super(message, 'AUDIO_DECODE_FAILED');
  }
}

/** The offline render pipeline failed. */
export class RenderFailedError extends DomainError {
  constructor(message: string) {
    super(message, 'RENDER_FAILED');
  }
}

/** Too many heavy jobs are already running or queued; the client should retry shortly. */
export class ServerBusyError extends DomainError {
  constructor() {
    super('The render service is busy. Please try again in a few seconds.', 'SERVER_BUSY');
  }
}
