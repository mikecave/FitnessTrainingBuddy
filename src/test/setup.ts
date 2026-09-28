// Vitest setup: polyfills IndexedDB so Dexie-backed repo code can run under
// jsdom/node without a real browser.
import 'fake-indexeddb/auto';
