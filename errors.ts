// FirstPass Studio - what went wrong, from anything thrown. A catch gets unknown: usually an Error, but a
// callback can reject with anything.

// The words to log or show.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}

// A Node system error's code ('ENOENT', 'EADDRINUSE' and so on), or ''.
export function errorCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : '';
}

// The stack to log, or the words when there is none.
export function errorStack(err: unknown): string {
  return (err instanceof Error && err.stack) || errorMessage(err);
}

// Why a fetch() failed: its cause's code or words ('ENOTFOUND', 'connect ECONNREFUSED ...'), else its own words.
export function fetchFailure(err: unknown): string {
  const cause = err instanceof Error && err.cause ? err.cause : null;
  return cause ? errorCode(cause) || errorMessage(cause) : errorMessage(err);
}
