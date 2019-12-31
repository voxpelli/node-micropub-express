// @ts-check
/// <reference types="node" />
/// <reference types="body-parser" />

'use strict';

const qs = require('querystring');

const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');

const fetch = require('node-fetch');
const VError = require('verror');

const pkg = require('./package.json');
const defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

/** @typedef {import('bunyan-adaptor').BunyanLite} BunyanLite */
/** @typedef {import('querystring').ParsedUrlQuery} ParsedUrlQuery */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').Router} Router */

// TODO: Figure out how to import this definition from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/03fddd7a3f2322433a867d9edcee561ac85d950d/types/multer/index.d.ts#L103-L124
/** @typedef {*} MulterFile */

/**
 * @template T
 * @typedef {T|T[]} MaybeArray
 */
/**
 * @template T
 * @typedef {T|Promise<T>} MaybePromised
 */

/**
 * @typedef TokenReference
 * @property {string} me
 * @property {string} endpoint
 */

/**
 * @typedef MinimalParsedMicropubStructure
 * @property {string[]|undefined} [type]
 * @property {Object<string,any[]>} properties
 * @property {Object<string,any[]>} mp
 */

/** @typedef {MinimalParsedMicropubStructure & { [reservedPropertyName: string]: any }} ParsedMicropubStructure */

/**
 * @template T
 * @param {MaybeArray<T>} value
 * @returns {T[]}
 */
const ensureArrayAndCloneIt = (value) => Array.isArray(value) ? [...value] : [value];

const getBunyanAdaptor = (function () {
  /** @type {BunyanLite} */
  let bunyanAdaptor;
  return () => {
    if (!bunyanAdaptor) { bunyanAdaptor = require('bunyan-adaptor')(); }
    return bunyanAdaptor;
  };
}());

const requiredScope = Object.freeze(['create', 'post']);

const formEncodedKey = /\[([^\]]*)\]$/;

class TokenError extends Error {}
class TokenScopeError extends TokenError {
  /**
   * @param {string} message
   * @param {string} scope
   */
  constructor (message, scope) {
    super(message);
    this.scope = scope;
  }
}

/** @typedef {string|number|boolean} BasicEncodeableTypes */

/**
 * @param {BasicEncodeableTypes|BasicEncodeableTypes[]|Object<string,any>} data
 * @param {string} [key]
 * @returns {string}
 */
const internalQueryStringEncodeWithArrayBrackets = function (data, key) {
  if (Array.isArray(data)) {
    return data.map(item => internalQueryStringEncodeWithArrayBrackets(item, key + '[]')).join('&');
  } else if (typeof data === 'object' && data !== null) {
    return Object.keys(data)
      .map(dataKey => internalQueryStringEncodeWithArrayBrackets(data[dataKey], key ? key + '[' + dataKey + ']' : dataKey))
      .filter(item => !!item)
      .join('&');
  } else if (!key || typeof data === 'undefined') {
    return '';
  } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' || data === null) {
    return encodeURIComponent(key) + (data ? '=' + encodeURIComponent(data) : '');
  } else {
    throw new TypeError(`Invalid data type encountered: ${typeof data}`);
  }
};

/**
 * @param {Object<string,any>} data
 * @returns {string}
 */
const queryStringEncodeWithArrayBrackets = function (data) {
  return internalQueryStringEncodeWithArrayBrackets(data);
};

/**
 * @param {Response} res
 * @param {string} [reason]
 * @param {number} [code]
 */
const badRequest = function (res, reason, code) {
  res.status(code || 400).json({
    error: 'invalid_request',
    error_description: reason
  });
};

/**
 * @param {string} url
 * @returns {string}
 */
const normalizeUrl = function (url) {
  if (url.substr(-1) !== '/') {
    url += '/';
  }
  return url;
};

const reservedProperties = Object.freeze([
  'access_token',
  'q',
  'url',
  'update',
  'add',
  'delete'
]);

/**
 * @param {Object<string,any>} result
 */
const cleanEmptyKeys = function (result) {
  for (const key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }
};

/**
 * @param {ParsedUrlQuery} body
 * @returns {ParsedMicropubStructure}
 */
const processFormEncodedBody = function (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    type: body.h ? ['h-' + body.h] : undefined,
    properties: {},
    mp: {}
  };

  if (body.h) {
    delete body.h;
  }

  for (let key in body) {
    const rawValue = body[key];

    if (reservedProperties.includes(key)) {
      result[key] = rawValue;
    } else {
      /** @type {Object<string,any[]>} */
      let targetProperty;
      /** @type {string|string[]|Object<string,any>} */
      let value = rawValue;
      let subKey;

      while ((subKey = formEncodedKey.exec(key))) {
        if (subKey[1]) {
          /** @type {Object<string,any>} */
          const tmp = {};
          tmp[subKey[1]] = value;
          value = tmp;
        } else {
          value = ensureArrayAndCloneIt(value);
        }
        key = key.slice(0, subKey.index);
      }

      if (key.startsWith('mp-')) {
        key = key.substr(3);
        targetProperty = result.mp;
      } else {
        targetProperty = result.properties;
      }

      targetProperty[key] = ensureArrayAndCloneIt(value);
    }
  }

  cleanEmptyKeys(result);

  return result;
};

/**
 * @param {Object<string,any>} body
 * @returns {ParsedMicropubStructure}
 */
const processJsonEncodedBody = function (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    properties: {},
    mp: {}
  };

  for (let key in body) {
    const value = body[key];

    if (reservedProperties.includes(key) || ['properties', 'type'].includes(key)) {
      result[key] = value;
    } else if (key.startsWith('mp-')) {
      key = key.substr(3);
      result.mp[key] = [].concat(value);
    }
  }

  for (const key in body.properties) {
    if (['url'].includes(key)) {
      result[key] = result[key] || [].concat(body.properties[key])[0];
      delete body.properties[key];
    }
  }

  cleanEmptyKeys(result);

  return result;
};

/**
 * @template T
 * @typedef FilesByType
 * @property {T[]} [audio]
 * @property {T[]} [photo]
 * @property {T[]} [video]
 */
/** @typedef {{ filename: string, buffer: Buffer }} ProcessedFile */

/**
 * @template T
 * @param {T} body
 * @param {{ [type: string]: MulterFile[] }} files
 * @param {BunyanLite} logger
 * @returns {T & {files?: FilesByType<ProcessedFile>}}
 */
const processFiles = function (body, files, logger) {
  /** @type {FilesByType<ProcessedFile>} */
  const allResults = {};

  for (const type of ['video', 'photo', 'audio']) {
    /** @type {ProcessedFile[]} */
    const result = [];
    const typeFiles = [...(files[type] || []), ...(files[type + '[]'] || [])];

    typeFiles.forEach(file => {
      if (file.truncated) {
        logger.warn('File was truncated');
        return;
      }

      result.push({
        filename: file.originalname,
        buffer: file.buffer
      });
    });

    if (result.length) {
      // @ts-ignore
      allResults[type] = result;
    }
  }

  return Object.getOwnPropertyNames(allResults)[0] !== undefined
    ? { ...body, files: allResults }
    : { ...body };
};

/** @typedef {(req?: Request)=>(MaybePromised<MaybeArray<TokenReference>>)} TokenReferenceResolver */
/** @typedef {TokenReferenceResolver|MaybeArray<TokenReference>} TokenReferenceOption */

/**
 * @param {Object} options
 * @param {(data: ParsedMicropubStructure, req: Request) => (undefined|{url: string})} options.handler
 * @param {TokenReferenceOption} options.tokenReference
 * @param {BunyanLite} [options.logger]
 * @param {(q: string, req: Request) => any} [options.queryHandler]
 * @param {string} [options.userAgent]
 * @returns {Router}
 */
module.exports = function (options) {
  const logger = options.logger || getBunyanAdaptor();

  if (!options.tokenReference || !['function', 'object'].includes(typeof options.tokenReference)) {
    throw new Error('No correct token set. It\'s needed for authorization checks.');
  }

  if (!options.handler || typeof options.handler !== 'function') {
    throw new Error('No correct handler set. It\'s needed to actually process a Micropub request.');
  }

  const userAgent = ((options.userAgent || '') + ' ' + defaultUserAgent).trim();

  /** @type {TokenReferenceResolver}  */
  // @ts-ignore
  const tokenReference = typeof options.tokenReference === 'function' ? options.tokenReference : async () => options.tokenReference;

  // Helper functions

  /**
   * @param {string} token
   * @param {TokenReference[]} references
   * @returns {Promise<boolean|TokenError>}
   */
  const matchAnyTokenReference = async function (token, references) {
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
          validateToken(token, endpoints[endpoint], endpoint)
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

  /**
   * @param {string} token
   * @param {string[]} meReferences
   * @param {string} endpoint
   * @returns {Promise<true|TokenError>}
   */
  const validateToken = async function (token, meReferences, endpoint) {
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

    // @ts-ignore
    const response = await fetch(endpoint, fetchOptions);
    // @ts-ignore
    const body = await response.text();
    const { me, scope } = qs.parse(body) || {};

    if (!me || !scope || Array.isArray(me) || Array.isArray(scope)) {
      throw new TokenError('Invalid token');
    }

    meReferences = meReferences.map(normalizeUrl);

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

  // Router setup

  const router = express.Router({
    caseSensitive: true,
    mergeParams: true
  });

  router.use(bodyParser.urlencoded({ extended: false }));
  router.use(bodyParser.json());

  const storage = multer.memoryStorage();
  const upload = multer({ storage: storage });

  router.use(upload.fields(['video', 'photo', 'audio', 'video[]', 'photo[]', 'audio[]'].map(type => ({ name: type }))));

  // Ensure the needed parts are there
  router.use((req, res, next) => {
    logger.debug({ body: req.body }, 'Received a request');

    if (req.body) {
      if (req.is('json')) {
        req.body = processJsonEncodedBody(req.body);
      } else {
        req.body = processFormEncodedBody(req.body);
      }
    }

    if (req.files && !Array.isArray(req.files) && Object.getOwnPropertyNames(req.files)[0]) {
      req.body = processFiles(req.body, req.files, logger);
    }

    logger.debug({ body: req.body }, 'Processed a request');

    /** @type {string|undefined} */
    const token = (
      req.headers.authorization
        ? req.headers.authorization.trim().split(/\s+/)[1]
        : (
          req.body && req.body.access_token
            ? req.body.access_token
            : undefined
        )
    );

    if (token === undefined || !token) {
      logger.debug('Got a request with a missing token');
      return badRequest(res, 'Missing "Authorization" header or body parameter.', 401);
    }

    logger.debug('Found authorization token');

    // Not using "await" here as the middleware shouldn't be returning a Promise, as Express doesn't understand Promises natively yet and it could hide exceptions thrown
    Promise.resolve()
      .then(async () => {
        const resolvedTokenReference = await tokenReference(req);

        const valid = await matchAnyTokenReference(token, ensureArrayAndCloneIt(resolvedTokenReference));

        if (valid === true) { return next(); }
        if (valid && !(valid instanceof Error)) { return next(); }

        if (valid instanceof TokenScopeError) {
          return res.status(401).json({
            error: 'insufficient_scope',
            error_description: valid.message,
            scope: valid.scope
          });
        }

        res.status(403).json({
          error: 'forbidden',
          error_description: valid ? valid.message : undefined
        });
      })
      .catch(err => {
        logger.debug(err, 'An error occurred when trying to validate token');
        next(new VError(err, "Couldn't validate token"));
      });
  });

  router.get('/', (req, res, next) => {
    if (Object.keys(req.query).length === 0) {
      // If a simple GET is performed, then we just want to verify the authorization credentials
      return res.sendStatus(200);
    } else if (req.query.q !== undefined) {
      if (!options.queryHandler) {
        return req.query.q === 'config' ? res.json({}) : badRequest(res, 'Queries are not supported');
      }

      // Not using "await" here as the middleware shouldn't be returning a Promise, as Express doesn't understand Promises natively yet and it could hide exceptions thrown
      Promise.resolve()
        .then(async () => {
          const result = await options.queryHandler(req.query.q, req);

          if (!result) {
            return req.query.q === 'config' ? res.json({}) : badRequest(res, 'Query type is not supported');
          }

          res.format({
            'application/json': () => { res.json(result); },
            'application/x-www-form-urlencoded': () => {
              res.type('application/x-www-form-urlencoded').send(queryStringEncodeWithArrayBrackets(result));
            },
            default: () => { res.json(result); }
          });
        })
        .catch(err => {
          next(new VError(err, 'Error in query handling'));
        });
    } else {
      return badRequest(res, 'No known query parameters');
    }
  });

  router.post('/', (req, res, next) => {
    if (req.query.q) {
      return badRequest(res, 'Queries only supported with GET method', 405);
    } else if (req.body.mp && req.body.mp.action) {
      return badRequest(res, 'This endpoint does not yet support updates.', 501);
    } else if (!req.body.type) {
      return badRequest(res, 'Missing "h" value.');
    }

    const data = req.body;

    if (!data.properties) {
      return badRequest(res, 'Not finding any properties.');
    }

    // Not using "await" here as the middleware shouldn't be returning a Promise, as Express doesn't understand Promises natively yet and it could hide exceptions thrown
    Promise.resolve()
      .then(async () => {
        const result = await options.handler(data, req);

        if (!result || !result.url) {
          return res.sendStatus(400);
        }

        return res.redirect(201, result.url);
      })
      .catch(err => {
        next(new VError(err, 'Error in post handling'));
      });
  });

  return router;
};

module.exports.processFormEncodedBody = processFormEncodedBody;
module.exports.processJsonEncodedBody = processJsonEncodedBody;
module.exports.queryStringEncodeWithArrayBrackets = queryStringEncodeWithArrayBrackets;
