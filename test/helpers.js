// @ts-check
/// <reference types="node" />

/**
 * Parse a URL-encoded query string into an object, grouping duplicate keys into arrays.
 * Replacement for deprecated `node:querystring`'s `parse()`.
 *
 * @param {string} str
 * @returns {Record<string, string | string[]>}
 */
export function parseQueryString (str) {
  const params = new URLSearchParams(str);
  /** @type {Record<string, string | string[]>} */
  const result = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length === 1 ? /** @type {string} */ (values[0]) : values;
  }

  return result;
}
