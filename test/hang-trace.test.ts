import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trace, wrapAsync, extractCallerLocation, parseLocationFromFrame } from '../src/index.js';
import type { HangInfo } from '../src/types.js';

describe('hang-trace', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('1. Promise resolution before timeout', () => {
    it('does not trigger warnings and cleanly cancels timers when promise resolves', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let resolvePromise!: (val: string) => void;
      const promise = new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });

      const traced = trace(promise, { timeoutMs: 3000, label: 'resolvingPromise' });

      expect(vi.getTimerCount()).toBe(1);

      // Advance partially
      await vi.advanceTimersByTimeAsync(1500);
      expect(warnSpy).not.toHaveBeenCalled();

      // Settle promise
      resolvePromise('success');
      const result = await traced;

      expect(result).toBe('success');
      expect(warnSpy).not.toHaveBeenCalled();

      // Settle cleanup microtasks and check that timer is canceled
      expect(vi.getTimerCount()).toBe(0);

      // Advance past original timeout to verify timer does not trigger later
      await vi.advanceTimersByTimeAsync(3000);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('works with immediately resolved promises without leaving timers behind', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const promise = Promise.resolve('instant');
      const traced = trace(promise, { timeoutMs: 1000 });

      const result = await traced;
      expect(result).toBe('instant');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('2. Hanging promises & default console.warn', () => {
    it('triggers console.warn with caller location and label when timeoutMs is exceeded', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // A promise that never resolves or rejects
      const hangingPromise = new Promise(() => {});

      trace(hangingPromise, { timeoutMs: 2000, label: 'testHangingTask' });

      // Before timeout, no warning
      await vi.advanceTimersByTimeAsync(1999);
      expect(warnSpy).not.toHaveBeenCalled();

      // At timeout, warning fires
      await vi.advanceTimersByTimeAsync(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const warningMessage = warnSpy.mock.calls[0][0];
      expect(warningMessage).toContain('[hang-trace]');
      expect(warningMessage).toContain('testHangingTask');
      expect(warningMessage).toContain('2000ms');
      expect(warningMessage).toContain('Caller:');
      // Should reference this test file
      expect(warningMessage).toMatch(/hang-trace\.test\.ts/);
    });

    it('uses default timeout (4000ms) and <anonymous> label when none are provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hangingPromise = new Promise(() => {});
      trace(hangingPromise);

      await vi.advanceTimersByTimeAsync(3999);
      expect(warnSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const warningMessage = warnSpy.mock.calls[0][0];
      expect(warningMessage).toContain('[hang-trace]');
      expect(warningMessage).toContain('<anonymous>');
      expect(warningMessage).toContain('4000ms');
    });
  });

  describe('3. Custom onHang callback', () => {
    it('executes custom onHang callback with accurate HangInfo instead of console.warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hangEvents: HangInfo[] = [];

      const onHang = vi.fn((info: HangInfo) => {
        hangEvents.push(info);
      });

      const hangingPromise = new Promise(() => {});
      trace(hangingPromise, {
        timeoutMs: 1500,
        label: 'customCallbackPromise',
        onHang,
      });

      await vi.advanceTimersByTimeAsync(1500);

      // Console warn should be suppressed
      expect(warnSpy).not.toHaveBeenCalled();

      // onHang should be called once with correct details
      expect(onHang).toHaveBeenCalledTimes(1);
      expect(hangEvents.length).toBe(1);

      const event = hangEvents[0];
      expect(event.label).toBe('customCallbackPromise');
      expect(event.timeoutMs).toBe(1500);
      expect(event.location).toMatch(/hang-trace\.test\.ts:\d+:\d+/);
      expect(event.stack).toBeDefined();
      expect(event.stack).toContain('hang-trace.test.ts');
    });
  });

  describe('4. Production safety (process.env.NODE_ENV === "production")', () => {
    it('registers no timers and returns the exact input promise in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const originalPromise = new Promise(() => {});
      const resultPromise = trace(originalPromise, { timeoutMs: 1000, label: 'prodPromise' });

      // Exact reference equality
      expect(resultPromise).toBe(originalPromise);

      // Zero timers created
      expect(vi.getTimerCount()).toBe(0);

      // Advance time - nothing should ever happen
      await vi.advanceTimersByTimeAsync(5000);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns original function directly when wrapAsync is used in production', async () => {
      process.env.NODE_ENV = 'production';

      const originalFn = async (x: number) => x * 2;
      const wrapped = wrapAsync(originalFn, { timeoutMs: 1000 });

      expect(wrapped).toBe(originalFn);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('forces diagnostics in production when options.force is true', async () => {
      process.env.NODE_ENV = 'production';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hangingPromise = new Promise(() => {});
      trace(hangingPromise, { timeoutMs: 2000, label: 'forcedProdPromise', force: true });

      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1999);
      expect(warnSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('forcedProdPromise');
    });

    it('disabled: true overrides force: true', async () => {
      process.env.NODE_ENV = 'production';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const originalPromise = new Promise(() => {});
      const resultPromise = trace(originalPromise, {
        timeoutMs: 1000,
        disabled: true,
        force: true,
      });

      expect(resultPromise).toBe(originalPromise);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('forces wrapAsync diagnostics in production when options.force is true', async () => {
      process.env.NODE_ENV = 'production';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hangingFn = wrapAsync(
        async function forcedProdFn() {
          return new Promise(() => {});
        },
        { timeoutMs: 2000, force: true }
      );

      hangingFn();
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('forcedProdFn');
    });
  });

  describe('5. Manual disabled toggle', () => {
    it('bypasses tracking and returns original promise when disabled: true', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const originalPromise = new Promise(() => {});
      const resultPromise = trace(originalPromise, { disabled: true, timeoutMs: 1000 });

      expect(resultPromise).toBe(originalPromise);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('bypasses wrapAsync when disabled: true', async () => {
      const originalFn = async () => 'active';
      const wrapped = wrapAsync(originalFn, { disabled: true });

      expect(wrapped).toBe(originalFn);
    });
  });

  describe('6. Rejection handling & timer cleanup', () => {
    it('bubbles rejection properly and clears pending timers', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let rejectPromise!: (err: Error) => void;
      const promise = new Promise<never>((_, reject) => {
        rejectPromise = reject;
      });

      const traced = trace(promise, { timeoutMs: 2000, label: 'rejectingPromise' });

      expect(vi.getTimerCount()).toBe(1);

      const testError = new Error('Database connection failed');
      rejectPromise(testError);

      await expect(traced).rejects.toThrow('Database connection failed');

      // Verify timer is canceled immediately
      expect(vi.getTimerCount()).toBe(0);

      // Advance past timeout; ensure no warnings
      await vi.advanceTimersByTimeAsync(3000);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('7. wrapAsync() utility', () => {
    it('successfully calls wrapped async function and passes arguments and return value', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      async function multiply(a: number, b: number): Promise<number> {
        return a * b;
      }

      const wrappedMultiply = wrapAsync(multiply, { timeoutMs: 1000 });
      const result = await wrappedMultiply(6, 7);

      expect(result).toBe(42);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('uses function name as default label and warns when wrapped execution hangs', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hangingFn = wrapAsync(
        async function fetchUserProfile() {
          return new Promise(() => {});
        },
        { timeoutMs: 2500 }
      );

      hangingFn();

      await vi.advanceTimersByTimeAsync(2499);
      expect(warnSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain('fetchUserProfile');
      expect(msg).toContain('2500ms');
      expect(msg).toContain('Caller:');
      expect(msg).toMatch(/hang-trace\.test\.ts/);
    });

    it('preserves `this` context when wrapping methods', async () => {
      class Service {
        private multiplier = 10;

        async calculate(value: number): Promise<number> {
          return value * this.multiplier;
        }
      }

      const service = new Service();
      service.calculate = wrapAsync(service.calculate.bind(service));

      const res = await service.calculate(5);
      expect(res).toBe(50);
    });

    it('handles synchronous throw inside wrapped function by returning rejected Promise', async () => {
      const throwingFn = wrapAsync(() => {
        throw new Error('Immediate sync failure');
      });

      await expect(throwingFn()).rejects.toThrow('Immediate sync failure');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('8. Stack parsing & platform agnosticism', () => {
    it('parses V8 stack frame with function name', () => {
      const frame = '    at fetchUser (/src/services/user.ts:42:15)';
      const parsed = parseLocationFromFrame(frame);
      expect(parsed).toBe('fetchUser (/src/services/user.ts:42:15)');
    });

    it('parses V8 async stack frame', () => {
      const frame = '    at async loadData (C:\\project\\src\\data.ts:10:3)';
      const parsed = parseLocationFromFrame(frame);
      expect(parsed).toBe('loadData (C:\\project\\src\\data.ts:10:3)');
    });

    it('parses V8 anonymous stack frame without function name', () => {
      const frame = '    at /src/services/user.ts:42:15';
      const parsed = parseLocationFromFrame(frame);
      expect(parsed).toBe('/src/services/user.ts:42:15');
    });

    it('parses Firefox and Safari stack frames', () => {
      const ffFrame = 'loadProfile@http://localhost:3000/src/profile.ts:88:20';
      const parsedFF = parseLocationFromFrame(ffFrame);
      expect(parsedFF).toBe('loadProfile (http://localhost:3000/src/profile.ts:88:20)');

      const ffAnon = '@http://localhost:3000/src/profile.ts:88:20';
      const parsedAnon = parseLocationFromFrame(ffAnon);
      expect(parsedAnon).toBe('http://localhost:3000/src/profile.ts:88:20');
    });

    it('gracefully falls back when Error.captureStackTrace is not available', () => {
      const originalCapture = Error.captureStackTrace;
      let info: ReturnType<typeof extractCallerLocation>;
      try {
        // Temporarily simulate non-V8 environment (e.g. Firefox / Safari)
        (Error as any).captureStackTrace = undefined;

        function callerFunction() {
          return extractCallerLocation();
        }

        info = callerFunction();
      } finally {
        Error.captureStackTrace = originalCapture;
      }

      expect(info.location).toBeDefined();
      expect(info.location).not.toBe('unknown location');
      expect(info.location).toMatch(/callerFunction/);
    });

    it('returns unknown location when stack is completely empty', () => {
      const parsed = parseLocationFromFrame('');
      expect(parsed).toBe('unknown location');
    });
  });

  describe('9. Robustness & edge cases', () => {
    it('returns non-thenable / falsy inputs directly without throwing', () => {
      const nullResult = trace(null as any);
      expect(nullResult).toBeNull();

      const undefinedResult = trace(undefined as any);
      expect(undefinedResult).toBeUndefined();

      const objResult = trace({} as any);
      expect(objResult).toEqual({});
    });

    it('works with custom thenable without .finally', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let resolveHandler!: (v: string) => void;
      // Custom thenable lacking .finally
      const thenable = {
        then(onFulfilled: any, _onRejected?: any) {
          resolveHandler = onFulfilled;
          return this;
        },
      } as unknown as Promise<string>;

      const traced = trace(thenable, { timeoutMs: 2000 });
      expect(traced).toBeDefined();
      expect(vi.getTimerCount()).toBe(1);

      resolveHandler('thenableSuccess');
      expect(vi.getTimerCount()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
