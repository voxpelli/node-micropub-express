// @ts-check
/// <reference types="node" />

import { parse } from 'node:querystring';

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
export const validateToken = async function (token, meReferences, endpoint, userAgent, logger) {
  if (!token) {
    throw new TokenError('No token specified');
  }

  const fetchOptions = {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent
    }
  };

  const response = await fetch(endpoint, fetchOptions);
  const body = await response.text();
  const { me, scope } = parse(body) || {};

  if (!me || !scope || Array.isArray(me) || Array.isArray(scope)) {
    throw new TokenError('Invalid token');
  }

  meReferences = meReferences.map(url => normalizeUrl(url));

  if (!meReferences.includes(normalizeUrl(me))) {
    logger.debug('Token "me" didn\'t match any of: "' + meReferences.join('", "') + '", Got: "' + me + '"');
    throw new TokenError(`Token "me" didn't match any valid reference. Got: "${me}"`);
  }

  const scopeMatch = [' ', ','].some(separator => scope.split(separator).some(scope => requiredScope.includes(scope)));

  if (!scopeMatch) {
    const errMessage = `Missing "${requiredScope[0]}" scope, instead got: ${scope}`;
    logger.debug(errMessage);
    throw new TokenScopeError(errMessage, requiredScope[0]);
  }

  return true;
};

/**
 * @param {string} token
 * @param {import('./core.js').TokenReference[]} references
 * @param {string} userAgent
 * @param {BunyanLite} logger
 * @returns {Promise<boolean|TokenError>}
 */
export const matchAnyTokenReference = async function (token, references, userAgent, logger) {
  if (!references || !references.length) {
    return false;
  }

  /** @type {{ [endpoint: string]: string[] }} */
  const endpoints = {};

  references.forEach(reference => {
    endpoints[reference.endpoint] = endpoints[reference.endpoint] || [];
    endpoints[reference.endpoint].push(reference.me);
  });

  const result = await Promise.all(
    Object.keys(endpoints)
      .map(endpoint =>
        validateToken(token, endpoints[endpoint], endpoint, userAgent, logger)
          // Turn the rejected errors into resolved errors to get all statuses returned in the Promise.all()
          .catch(err => err)
      )
  );

  return (
    result.some(valid => valid === true) ||
    result.find(valid => valid instanceof TokenScopeError) ||
    result[0]
  );
};
