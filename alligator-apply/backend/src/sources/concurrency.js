import { withTimeout } from './utils.js';
import { getSourceTimeoutMs } from './scanConfig.js';

/**
 * Run async fn over items with limited concurrency.
 * Each item is wrapped in a timeout — one slow target cannot block the pool forever.
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R[]>} fn
 * @param {{ itemTimeoutMs?: number, itemLabel?: (item: T) => string }} [opts]
 */
export async function mapWithConcurrency(items, concurrency, fn, opts = {}) {
  const results = [];
  const errors = [];
  let index = 0;
  const itemTimeoutMs = opts.itemTimeoutMs ?? getSourceTimeoutMs();

  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      const item = items[i];
      const label = opts.itemLabel ? opts.itemLabel(item) : String(item);
      try {
        const batch = await withTimeout(
          Promise.resolve().then(() => fn(item)),
          itemTimeoutMs,
          label
        );
        if (Array.isArray(batch)) results.push(...batch);
        else if (batch) results.push(batch);
      } catch (err) {
        errors.push({
          target: item,
          error: err.message || String(err),
          stack: err.stack,
          httpStatus: err.httpStatus ?? null,
          httpBody: err.httpBody ? String(err.httpBody).slice(0, 500) : null,
        });
      }
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.allSettled(Array.from({ length: workers }, () => worker()));
  return { items: results, errors };
}
