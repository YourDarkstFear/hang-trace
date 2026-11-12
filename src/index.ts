import { extractCallerLocation } from './stack.js';
import type { HangInfo, HangOptions } from './types.js';

export type { HangInfo, HangOptions };

/**
 * Default handler when a Promise hangs without settling.
 * Prints a formatted warning to `console.warn` with caller location and stack trace.
 */
function defaultOnHang(info: HangInfo): void {
  const parts = [
    `[hang-trace] Promise "${info.label}" has been pending for ${info.timeoutMs}ms without resolving or rejecting.`,
    `Caller: ${info.location}`,
  ];

  if (info.stack) {
    parts.push(`\nStack trace:\n${info.stack}`);
  }

  console.warn(parts.join('\n'));
}

/**
 * Internal tracking implementation.
 */
function traceInternal<T>(
  promise: Promise<T>,
  options?: HangOptions,
  callerFn?: (...args: any[]) => any
): Promise<T> {
  // If not a thenable, return directly to prevent crashes
  if (!promise || typeof promise.then !== 'function') {
    return promise;
  }

  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs >= 0
      ? options.timeoutMs
      : 4000;
  const label = options?.label || '<anonymous>';

  // Capture caller location synchronously at invocation time
  const { location, stack } = extractCallerLocation(callerFn || trace);

  let timer: ReturnType<typeof setTimeout> | undefined;

  timer = setTimeout(() => {
    const info: HangInfo = {
      label,
      timeoutMs,
      location,
      stack,
    };

    if (typeof options?.onHang === 'function') {
      options.onHang(info);
    } else {
      defaultOnHang(info);
    }
  }, timeoutMs);

  // Unref timer in Node.js so it does not keep the event loop alive on its own
  if (options?.unref !== false) {
    (timer as { unref?: () => void })?.unref?.();
  }

  // Clear the timer immediately when the promise settles (resolved or rejected)
  const cleanup = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  if (typeof promise.finally === 'function') {
    return promise.finally(cleanup);
  }

  // Fallback for custom Promise/thenable implementations without .finally
  return promise.then(
    (value) => {
      cleanup();
      return value;
    },
    (reason) => {
      cleanup();
      throw reason;
    }
  );
}

/**
 * Tracks a Promise during development and triggers a warning or custom callback
 * if it remains unsettled (neither resolved nor rejected) past the specified timeout.
 *
 * In production (`process.env.NODE_ENV === 'production'`), this is a complete no-op
 * that returns the original Promise directly with zero overhead.
 *
 * @param promise The Promise to monitor.
 * @param options Optional configuration for timeout, label, and hang callback.
 * @returns The monitored Promise.
 */
export function trace<T>(promise: Promise<T>, options?: HangOptions): Promise<T> {
  const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  const shouldBypass = options?.disabled || (isProduction && !options?.force);
  if (shouldBypass) return promise;
  return traceInternal(promise, options, trace);
}

/**
 * Wraps an async function (or any function returning a Promise) with hang tracking.
 * Each invocation of the returned function will be monitored for hanging promises.
 *
 * In production (`process.env.NODE_ENV === 'production'`), returns the original function directly,
 * unless overridden with `force: true`.
 *
 * @param fn The async function to wrap.
 * @param options Optional configuration for timeout, label, and hang callback.
 * @returns The wrapped function with the same signature.
 */
export function wrapAsync<Args extends unknown[], Return>(
  fn: (...args: Args) => Promise<Return>,
  options?: HangOptions
): (...args: Args) => Promise<Return> {
  const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  const shouldBypass = options?.disabled || (isProduction && !options?.force);
  if (shouldBypass) return fn;

  const defaultLabel = options?.label || fn.name || '<anonymous>';
  const mergedOptions: HangOptions = {
    ...options,
    label: defaultLabel,
  };

  return function hangTraceWrapper(this: unknown, ...args: Args): Promise<Return> {
    const isProdCall = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    const shouldBypassCall = mergedOptions.disabled || (isProdCall && !mergedOptions.force);
    if (shouldBypassCall) {
      return fn.apply(this, args);
    }

    let promise: Promise<Return>;
    try {
      promise = fn.apply(this, args);
    } catch (syncError) {
      return Promise.reject(syncError);
    }

    return traceInternal(promise, mergedOptions, hangTraceWrapper);
  };
}

export { extractCallerLocation, parseLocationFromFrame } from './stack.js';
