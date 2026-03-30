// @ts-check
/// <reference types="node" />

import { normalizeUrl, requiredScope, TokenError, TokenScopeError } from './core.js';

/** @typedef {import('./core.js').BunyanLite} BunyanLite */

/**
 * @param {string} token
 * @param {string[]} meReferences
 * @param {string} endpoint
 * @param {string} userAgent
 * @param {BunyanLite} logger
 * @returns {Promise<true|TokenError>}
 */
async function validateToken (token, meReferences, endpoint, userAgent, logger) {
  if (!token) {
    throw new TokenError('No token specified');
  }

  const fetchOptions = {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
  };

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available via --experimental-fetch on Node 20, stable on 21+
  const response = await fetch(endpoint, fetchOptions);
  const body = await response.text();
  const params = new URLSearchParams(body);
  const me = params.get('me');
  const scope = params.get('scope');

  if (!me || !scope) {
    throw new TokenError('Invalid token');
  }

  meReferences = meReferences.map(url => normalizeUrl(url));

  if (!meReferences.includes(normalizeUrl(me))) {
    logger.debug('Token "me" didn\'t match any of: "' + meReferences.join('", "') + '", Got: "' + me + '"');
    throw new TokenError(`Token "me" didn't match any valid reference. Got: "${me}"`);
  }

  const scopeMatch = [' ', ','].some(separator => scope.split(separator).some(s => requiredScope.includes(s)));

  if (!scopeMatch) {
    const errMessage = `Missing "${requiredScope[0] ?? 'create'}" scope, instead got: ${scope}`;
    logger.debug(errMessage);
    throw new TokenScopeError(errMessage, requiredScope[0] ?? 'create');
  }

  return true;
}

/**
 * @param {string} token
 * @param {import('./core.js').TokenReference[]} references
 * @param {string} userAgent
 * @param {BunyanLite} logger
 * @returns {Promise<boolean|TokenError>}
 */
export async function matchAnyTokenReference (token, references, userAgent, logger) {
  if (!references || !references.length) {
    return false;
  }

  /** @type {{ [endpoint: string]: string[] }} */
  const endpoints = {};

  for (const reference of references) {
    const ep = endpoints[reference.endpoint] ?? (endpoints[reference.endpoint] = []);
    ep.push(reference.me);
  }

  const result = await Promise.all(
    Object.keys(endpoints)
      .map(endpoint => {
        /** @type {string[]} */
        const meRefs = /** @type {string[]} */ (endpoints[endpoint]);
        return validateToken(token, meRefs, endpoint, userAgent, logger)
          // Turn rejected errors into resolved errors to collect all statuses via Promise.all()
          // eslint-disable-next-line jsdoc/require-returns
          .catch(/** @param {TokenError} err */ (err) => err);
      })
  );

  return (
    result.includes(true) ||
    result.find(valid => valid instanceof TokenScopeError) ||
    result[0] ||
    false
  );
}
