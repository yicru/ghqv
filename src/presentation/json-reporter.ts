export interface JsonEnvelopeOk<T> {
  schemaVersion: 1;
  command: string;
  ok: true;
  data: T;
  warnings: string[];
}

export interface JsonEnvelopeError {
  schemaVersion: 1;
  command: string;
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: Record<string, unknown>;
  };
}

export type JsonEnvelope<T> = JsonEnvelopeOk<T> | JsonEnvelopeError;

export function okEnvelope<T>(
  command: string,
  data: T,
  warnings: string[] = [],
): JsonEnvelopeOk<T> {
  return { schemaVersion: 1, command, ok: true, data, warnings };
}

export function errorEnvelope(
  command: string,
  code: string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>,
): JsonEnvelopeError {
  return { schemaVersion: 1, command, ok: false, error: { code, message, hint, details } };
}

export function emitJson(envelope: JsonEnvelope<unknown>): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
