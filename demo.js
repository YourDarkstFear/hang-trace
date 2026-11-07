import { trace } from 'hang-trace';

console.log('🚀 Calling fetchUserProfile()...');

// Create a Promise that neither resolves nor rejects
const hangingTask = new Promise(() => {});

// Trace with a 3000ms diagnostic timeout
trace(hangingTask, {
  label: 'fetchUserProfile',
  timeoutMs: 3000,
});

// Keep event loop active to simulate application/server activity
const keepAlive = setInterval(() => {}, 500);

setTimeout(() => {
  clearInterval(keepAlive);
  console.log('\n✅ Hanging Promise detected with exact caller location!');
  process.exit(0);
}, 4500);
