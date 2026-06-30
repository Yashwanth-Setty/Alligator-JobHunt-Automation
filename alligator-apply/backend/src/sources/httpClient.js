const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'AlligatorApply/1.0 (job-hunt; +https://github.com/Yashwanth-Setty/Alligator-JobHunt-Automation)',
};

async function fetchJsonWithMethod(url, options = {}) {
  const { timeoutMs = 10000, method = 'GET', body, onHttpResponse, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = { ...DEFAULT_HEADERS, ...(init.headers || {}) };
  if (body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  try {
    const res = await fetch(url, {
      ...init,
      method,
      signal: controller.signal,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    onHttpResponse?.({ url, status: res.status, ok: res.ok, method });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(
        `HTTP ${res.status} ${res.statusText} for ${url}${text ? `: ${text.slice(0, 180)}` : ''}`
      );
      err.httpStatus = res.status;
      err.httpBody = text.slice(0, 500);
      throw err;
    }

    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      onHttpResponse?.({ url, status: 408, ok: false, method, timedOut: true });
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      timeoutErr.httpStatus = 408;
      throw timeoutErr;
    }
    if (!err.message?.startsWith('HTTP ') && !err.httpStatus) {
      onHttpResponse?.({ url, status: null, ok: false, method, error: err.message });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function fetchJson(url, options = {}) {
  return fetchJsonWithMethod(url, { ...options, method: options.method || 'GET' });
}

/**
 * @param {string} url
 * @param {object} body
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function fetchJsonPost(url, body, options = {}) {
  return fetchJsonWithMethod(url, { ...options, method: 'POST', body });
}
