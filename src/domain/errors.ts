export const EXIT_CODE = {
  OK: 0,
  INTERNAL_ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  EXTERNAL: 5,
  IO: 6,
  LOCKED: 7,
  DRIFT: 10,
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export type GhqvErrorCode =
  | 'GHQV_USAGE_ERROR'
  | 'GHQV_WORKSPACE_NOT_FOUND'
  | 'GHQV_WORKSPACE_INVALID'
  | 'GHQV_MANIFEST_NOT_FOUND'
  | 'GHQV_MANIFEST_PARSE_ERROR'
  | 'GHQV_MANIFEST_INVALID'
  | 'GHQV_UNSUPPORTED_MANIFEST_VERSION'
  | 'GHQV_SOURCE_NOT_FOUND'
  | 'GHQV_SOURCE_AMBIGUOUS'
  | 'GHQV_SOURCE_INVALID'
  | 'GHQV_UNSUPPORTED_VCS'
  | 'GHQV_DESTINATION_CONFLICT'
  | 'GHQV_LINK_OWNERSHIP_CONFLICT'
  | 'GHQV_MANAGED_BLOCK_INVALID'
  | 'GHQV_LOCKED'
  | 'GHQV_EXTERNAL_COMMAND_FAILED'
  | 'GHQV_IO_ERROR'
  | 'GHQV_INTERRUPTED'
  | 'GHQV_INTERNAL_ERROR';

export interface GhqvErrorOptions {
  hint?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class GhqvError extends Error {
  readonly code: GhqvErrorCode;
  readonly exitCode: ExitCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: GhqvErrorCode,
    message: string,
    exitCode: ExitCode,
    options?: GhqvErrorOptions,
  ) {
    super(message, { cause: options?.cause });
    this.name = 'GhqvError';
    this.code = code;
    this.exitCode = exitCode;
    this.hint = options?.hint;
    this.details = options?.details;
  }
}

export function internalError(message: string, cause?: unknown): GhqvError {
  return new GhqvError('GHQV_INTERNAL_ERROR', message, EXIT_CODE.INTERNAL_ERROR, { cause });
}
