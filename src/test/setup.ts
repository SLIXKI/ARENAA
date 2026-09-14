import { beforeEach, vi } from 'vitest';

/** Minimal in-memory Storage implementing the Web Storage API. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

const store = new MemoryStorage();

// The utils under test read `window.localStorage` and `window.location` at call
// time, so stubbing the global object is enough — no DOM required.
const win = {
  localStorage: store,
  location: { origin: 'https://router.test', protocol: 'https:', host: 'router.test' },
  navigator: { clipboard: undefined },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  speechSynthesis: undefined,
};

(globalThis as any).window = win;
(globalThis as any).localStorage = store;
// Node 22 exposes `navigator` as a getter-only global, so it must be redefined
// rather than assigned.
try {
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
} catch { /* not needed by these tests */ }

beforeEach(() => {
  store.clear();
  vi.useRealTimers();
});

export { store };
