# hang-trace ⏱️🔍

> Catch hanging, dangling Promises during development with exact caller file and line numbers. Zero runtime dependencies. Zero production cost.

[![npm version](https://img.shields.io/npm/v/hang-trace.svg)](https://www.npmjs.com/package/hang-trace)
[![license](https://img.shields.io/npm/l/hang-trace.svg)](LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/hang-trace)](https://bundlephobia.com/package/hang-trace)

---

## The Problem: Silent Hangs & Infinite Spinners

Have you ever encountered a UI screen stuck on an **infinite loading skeleton**, a script hanging indefinitely in CI, or a backend request that never times out and prints **no console error**?

```ts
// ❌ If an upstream callback is dropped or an event never fires,
// this Promise neither resolves nor rejects. Silent freeze!
const response = await new Promise((resolve) => {
  eventEmitter.once('data', resolve); // Listener never triggers!
});
```

JavaScript Promises have no built-in timeout diagnostics. When a Promise neither resolves nor rejects:
- No error is thrown.
- No stack trace is printed.
- The thread or browser tab remains in limbo.
- Finding which line created the zombie Promise requires painful manual debugging with `console.log`.

**`hang-trace`** solves this instantly. Wrap any Promise or async function: if it remains pending past the diagnostic threshold, you get an immediate console warning pointing directly to the exact file and line number.

```
[hang-trace] Promise "fetchUser" has been pending for 4000ms without resolving or rejecting.
Caller: src/services/user.ts:42:15

Stack trace:
    at fetchUser (src/services/user.ts:42:15)
    at loadProfile (src/views/profile.ts:18:9)
```

---

## ✨ Features

- 🪶 **Zero Runtime Dependencies:** Completely self-contained with no external baggage.
- ⚡ **Zero Production Cost:** In `process.env.NODE_ENV === 'production'`, it is a pure no-op returning the original Promise directly. Fully tree-shakeable.
- 📍 **Precise Caller Location:** Accurately extracts the calling file, line, and column across V8 (Node/Chrome/Edge), Firefox, and Safari.
- 🔄 **Event Loop Friendly:** Calls `timer.unref?.()` in Node.js so diagnostic timers never keep processes alive.
- 🧹 **Zero Memory Leaks:** Automatically cancels timers the microsecond a promise settles (resolved or rejected).
- 📦 **Dual ESM & CommonJS:** Native support for both modern ES Modules (`.mjs`) and legacy CommonJS (`.cjs`), with full TypeScript definitions (`.d.ts`).

---

## 🚀 Quickstart (1 Minute)

### Install

```bash
npm install hang-trace
```
*(or via `pnpm add hang-trace` / `yarn add hang-trace` / `bun add hang-trace`)*

### 1. Monitor an Individual Promise with `trace()`

Wrap any pending Promise with `trace()`:

```ts
import { trace } from 'hang-trace';

// Warns if the Promise doesn't settle within 4000ms (default)
const data = await trace(fetchPendingResource(), {
  label: 'fetchPendingResource',
  timeoutMs: 3000,
});
```

### 2. Monitor Async Functions with `wrapAsync()`

Wrap an entire function to trace every execution:

```ts
import { wrapAsync } from 'hang-trace';

const saveUserSettings = wrapAsync(
  async (userId: string, settings: Settings) => {
    return await api.post(`/users/${userId}`, settings);
  },
  { timeoutMs: 5000 }
);

// If this call hangs, logs: Caller: src/handlers/settings.ts:25:7
await saveUserSettings('user_123', { theme: 'dark' });
```

---

## 🛠️ API Reference

### `trace<T>(promise: Promise<T>, options?: HangOptions): Promise<T>`

Wraps a Promise. In development, registers a diagnostic timer that fires if the Promise remains unsettled after `timeoutMs`. When settled, the timer is cleared immediately.

```ts
const user = await trace(authService.login(credentials), {
  label: 'AuthService.login',
  timeoutMs: 2500,
});
```

### `wrapAsync<Args, Return>(fn: (...args: Args) => Promise<Return>, options?: HangOptions): (...args: Args) => Promise<Return>`

Higher-order function wrapping an async function. Captures the call site each time the wrapped function is invoked.

```ts
const processOrder = wrapAsync(submitOrder, { label: 'SubmitOrder' });
```

---

### Configuration: `HangOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `timeoutMs` | `number` | `4000` | Inactivity duration (ms) before alerting. |
| `label` | `string` | `<anonymous>` or function name | Identifier displayed in logs and alerts. |
| `onHang` | `(info: HangInfo) => void` | `undefined` | Custom alert callback. When provided, replaces `console.warn`. |
| `disabled` | `boolean` | `false` | When `true`, completely disables tracking and returns the input directly. |

---

### Callback Payload: `HangInfo`

When `onHang` is provided, it receives a `HangInfo` object:

```ts
export interface HangInfo {
  label: string;      // The configured or inferred identifier
  timeoutMs: number;  // The elapsed timeout duration in ms
  location: string;   // Clean caller location (e.g., "src/api.ts:84:12")
  stack?: string;     // Full stack trace starting from the caller frame
}
```

#### Example: Custom Alert (Telemetry / Dev Modal)

```ts
import { trace } from 'hang-trace';

const data = await trace(unreliableCall(), {
  label: 'CriticalTask',
  timeoutMs: 2000,
  onHang: (info) => {
    // Forward to Sentry, error overlay, or custom logger
    console.error(`[ALERT] Hanging task detected at ${info.location}`);
    toast.warning(`Task "${info.label}" is taking unusually long!`);
  },
});
```

---

## 🔒 Production Safety & Zero Cost

In production builds (`process.env.NODE_ENV === 'production'`) or when `disabled: true`:
- **Zero timers registered:** `setTimeout` is never called.
- **Zero stack captures:** `Error.captureStackTrace` and `new Error()` are never touched.
- **Reference equality:** Returns the exact input promise / function instance directly.
- **Tree-shakeable:** Compilers and bundlers (Vite, Rollup, Webpack, esbuild) can eliminate unused code paths cleanly.

---

## 🧪 Testing

Run unit tests via Vitest:

```bash
npm test
```

Build dual ESM/CJS bundles:

```bash
npm run build
```

---

## 📄 License

[MIT](LICENSE) © 2026 hang-trace contributors
