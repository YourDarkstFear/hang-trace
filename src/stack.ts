export interface CallerInfo {
  location: string;
  stack?: string;
}

/**
 * Parses a single stack frame line into a clean caller location.
 * Supports V8 (Node/Chrome/Edge), Firefox, and Safari formats.
 */
export function parseLocationFromFrame(frameLine: string): string {
  const line = frameLine.trim();
  if (!line) {
    return 'unknown location';
  }

  // V8 pattern: "at functionName (file:line:col)" or "at file:line:col" or "at async functionName (file:line:col)"
  const v8Match = line.match(/^at (?:async\s+)?(?:(.+?)\s+\((.+)\)|(.+))$/);
  if (v8Match) {
    const fnName = v8Match[1];
    const loc = v8Match[2] || v8Match[3];
    return fnName ? `${fnName} (${loc})` : loc;
  }

  // Firefox / Safari pattern: "functionName@file:line:col" or "@file:line:col"
  const ffMatch = line.match(/^(?:(.*?)@)?(.+)$/);
  if (ffMatch) {
    const fnName = ffMatch[1];
    const loc = ffMatch[2];
    return fnName ? `${fnName} (${loc})` : loc;
  }

  return line;
}

const INTERNAL_FUNCTIONS = new Set([
  'extractCallerLocation',
  'traceInternal',
  'hangTraceWrapper',
  'wrapAsync',
  'trace',
]);

function matchesFunctionName(line: string, targetName: string): boolean {
  if (!targetName) return false;
  const trimmed = line.trim();
  const v8 = trimmed.match(/^at (?:async\s+)?([^\s(]+)\s*\(/);
  if (v8 && v8[1] === targetName) return true;
  const ff = trimmed.match(/^([^@\s]+)@/);
  if (ff && ff[1] === targetName) return true;
  return false;
}

function isInternalFrame(line: string): boolean {
  const trimmed = line.trim();
  const v8 = trimmed.match(/^at (?:async\s+)?([^\s(]+)\s*\(/);
  if (v8 && INTERNAL_FUNCTIONS.has(v8[1])) return true;
  const ff = trimmed.match(/^([^@\s]+)@/);
  if (ff && INTERNAL_FUNCTIONS.has(ff[1])) return true;
  return false;
}

/**
 * Extracts the caller location and filtered stack trace.
 * Uses V8 Error.captureStackTrace when available, with a cross-browser fallback
 * to `new Error().stack` parsing.
 *
 * @param fnToOmit Optional function to omit from the captured stack trace.
 */
export function extractCallerLocation(fnToOmit?: (...args: any[]) => any): CallerInfo {
  let rawStack = '';

  if (typeof Error.captureStackTrace === 'function') {
    const dummy: { stack?: string } = {};
    if (fnToOmit) {
      Error.captureStackTrace(dummy, fnToOmit);
    } else {
      Error.captureStackTrace(dummy, extractCallerLocation);
    }
    rawStack = dummy.stack || '';
  } else {
    const err = new Error();
    rawStack = err.stack || '';
  }

  if (!rawStack) {
    return {
      location: 'unknown location',
      stack: undefined,
    };
  }

  const lines = rawStack.split('\n');
  const frameLines = lines.filter(
    (l) => l.trim().length > 0 && !l.trim().startsWith('Error')
  );

  let startIndex = 0;

  // When Error.captureStackTrace was NOT used, find where internal frames end.
  if (typeof Error.captureStackTrace !== 'function') {
    if (fnToOmit && fnToOmit.name) {
      let lastMatch = -1;
      for (let i = 0; i < frameLines.length; i++) {
        if (matchesFunctionName(frameLines[i], fnToOmit.name)) {
          lastMatch = i;
        }
      }
      if (lastMatch !== -1) {
        startIndex = lastMatch + 1;
      }
    } else {
      let lastInternal = -1;
      for (let i = 0; i < frameLines.length; i++) {
        if (isInternalFrame(frameLines[i])) {
          lastInternal = i;
        }
      }
      if (lastInternal !== -1) {
        startIndex = lastInternal + 1;
      }
    }
  }

  const remaining = frameLines.slice(startIndex);
  const callerFrame = remaining[0];
  const location = callerFrame ? parseLocationFromFrame(callerFrame) : 'unknown location';

  return {
    location,
    stack: remaining.length > 0 ? remaining.join('\n') : undefined,
  };
}
