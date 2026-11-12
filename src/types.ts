/**
 * Information payload passed to onHang callback or logged to console.warn
 * when a Promise hangs.
 */
export interface HangInfo {
  /**
   * Identifier or label of the hanging promise or wrapped function.
   */
  label: string;

  /**
   * Timeout in milliseconds after which the promise was considered hanging.
   */
  timeoutMs: number;

  /**
   * The call site location (file, line number, column) where trace() or the wrapped function was called.
   */
  location: string;

  /**
   * Formatted stack trace starting from the caller frame.
   */
  stack?: string;
}

/**
 * Configuration options for hang-trace.
 */
export interface HangOptions {
  /**
   * Milliseconds of inactivity before flagging the Promise as hanging.
   * @default 4000
   */
  timeoutMs?: number;

  /**
   * Custom identifier or function name for logs.
   * Defaults to `<anonymous>` for trace() or the wrapped function's name for wrapAsync().
   */
  label?: string;

  /**
   * Optional custom callback invoked when a promise exceeds timeoutMs.
   * When provided, default console.warn is suppressed.
   */
  onHang?: (info: HangInfo) => void;

  /**
   * Manual opt-out toggle. When true, hang tracking is completely bypassed.
   * @default false
   */
  disabled?: boolean;

  /**
   * If true, overrides `process.env.NODE_ENV === 'production'` and forces diagnostics to run.
   * @default false
   */
  force?: boolean;

  /**
   * In Node.js, calls `timer.unref()` so the diagnostic timer does not keep the event loop alive on its own.
   * Set to `false` for short-lived CLI scripts.
   * @default true
   */
  unref?: boolean;
}
