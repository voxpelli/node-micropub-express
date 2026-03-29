// @ts-check
/// <reference types="node" />
/// <reference types="body-parser" />

import { createRequire } from 'node:module';

import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import createBunyanAdaptor from 'bunyan-adaptor';

import {
  ensureArrayAndCloneIt,
  processFormEncodedBody,
  processJsonEncodedBody,
  processFiles,
  queryStringEncodeWithArrayBrackets,
  TokenScopeError,
} from './lib/core.js';
import { matchAnyTokenReference } from './lib/token.js';

const require = createRequire(import.meta.url);
/** @type {{ name: string, version: string, homepage?: string }} */
const pkg = require('./package.json');

/** @typedef {import('./lib/core.js').TokenReference} TokenReference */
/**
 * @template T
 * @typedef {import('./lib/core.js').MaybeArray<T>} MaybeArray
 */
/**
 * @template T
 * @typedef {import('./lib/core.js').MaybePromised<T>} MaybePromised
 */
/** @typedef {import('./lib/core.js').ParsedMicropubStructure} ParsedMicropubStructure */
/** @typedef {import('bunyan-adaptor').BunyanLite} BunyanLite */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

const defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

const getBunyanAdaptor = (function () {
  /** @type {BunyanLite} */
  let bunyanAdaptor;
  return () => {
    if (!bunyanAdaptor) { bunyanAdaptor = createBunyanAdaptor(); }
    return bunyanAdaptor;
  };
}());

/**
 * @param {Response} res
 * @param {string} [reason]
 * @param {number} [code]
 */
function badRequest (res, reason, code) {
  res.status(code || 400).json({
    error: 'invalid_request',
    error_description: reason,
  });
}

/** @typedef {(req?: Request)=>(import('./lib/core.js').MaybePromised<import('./lib/core.js').MaybeArray<TokenReference>>)} TokenReferenceResolver */
/** @typedef {TokenReferenceResolver|import('./lib/core.js').MaybeArray<TokenReference>} TokenReferenceOption */

/**
 * @typedef MicropubExpressOptions
 * @property {(data: ParsedMicropubStructure, req: Request) => (undefined|{url: string})} handler
 * @property {TokenReferenceOption} tokenReference
 * @property {BunyanLite} [logger]
 * @property {(q: string, req: Request) => any} [queryHandler]
 * @property {string} [userAgent]
 */

/**
 * @param {MicropubExpressOptions} options
 * @returns {import('express').Router}
 */
function micropubExpress (options) {
  const {
    handler,
    logger = getBunyanAdaptor(),
    queryHandler,
  } = options;

  if (!options.tokenReference || !['function', 'object'].includes(typeof options.tokenReference)) {
    throw new Error('No correct token set. It\'s needed for authorization checks.');
  }

  if (!handler || typeof handler !== 'function') {
    throw new Error('No correct handler set. It\'s needed to actually process a Micropub request.');
  }

  const userAgent = ((options.userAgent || '') + ' ' + defaultUserAgent).trim();

  /** @type {TokenReferenceResolver} */
  const tokenReference = typeof options.tokenReference === 'function'
    ? options.tokenReference
    : /** @returns {MaybeArray<TokenReference>} */ () => /** @type {MaybeArray<TokenReference>} */ (options.tokenReference);

  // Router setup

  const router = express.Router({
    caseSensitive: true,
    mergeParams: true,
  });

  router.use(bodyParser.urlencoded({ extended: false }));
  router.use(bodyParser.json());

  const storage = multer.memoryStorage();
  const upload = multer({ storage });

  router.use(upload.fields(['video', 'photo', 'audio', 'video[]', 'photo[]', 'audio[]'].map(type => ({ name: type }))));

  // Ensure the needed parts are there
  router.use(
    /**
     * @param {Request} req
     * @param {Response} res
     * @param {import('express').NextFunction} next
     * @returns {void}
     */
    (req, res, next) => {
      logger.debug({ body: req.body }, 'Received a request');

      // body-parser v2 leaves req.body as undefined for empty/missing bodies
      if (!req.body) {
        req.body = {};
      }

      if (req.body && Object.keys(req.body).length > 0) {
        req.body = req.is('json') ? processJsonEncodedBody(req.body) : processFormEncodedBody(req.body);
      }

      if (req.files && !Array.isArray(req.files) && Object.getOwnPropertyNames(req.files)[0]) {
        req.body = processFiles(req.body, req.files, logger);
      }

      logger.debug({ body: req.body }, 'Processed a request');

      /** @type {ParsedMicropubStructure} */
      const body = req.body;

      /** @type {string|undefined} */
      const token = (
        req.headers.authorization
          ? req.headers.authorization.trim().split(/\s+/)[1]
          : (
              body && body.access_token
                ? body.access_token
                : undefined
            )
      );

      if (token === undefined || !token) {
        logger.debug('Got a request with a missing token');
        return badRequest(res, 'Missing "Authorization" header or body parameter.', 401);
      }

      logger.debug('Found authorization token');

      // Using async IIFE — Express 4.x doesn't support async middleware natively
      (async () => {
        const resolvedTokenReference = await tokenReference(req);

        const valid = await matchAnyTokenReference(token, ensureArrayAndCloneIt(resolvedTokenReference), userAgent, logger);

        if (valid === true) { return next(); }
        if (valid && !(valid instanceof Error)) { return next(); }

        if (valid instanceof TokenScopeError) {
          return res.status(401).json({
            error: 'insufficient_scope',
            error_description: valid.message,
            scope: valid.scope,
          });
        }

        res.status(403).json({
          error: 'forbidden',
          error_description: valid ? valid.message : undefined,
        });
        // eslint-disable-next-line promise/prefer-await-to-then -- Express 4.x doesn't support async middleware
      })().catch(/** @param {Error} err */ (err) => {
        logger.debug(err, 'An error occurred when trying to validate token');
        // eslint-disable-next-line promise/no-callback-in-promise
        next(new Error("Couldn't validate token", { cause: err }));
      });
    }
  );

  router.get('/',
    /**
     * @param {Request} req
     * @param {Response} res
     * @param {import('express').NextFunction} next
     * @returns {void}
     */
    (req, res, next) => {
      if (Object.keys(req.query).length === 0) {
        // If a simple GET is performed, then we just want to verify the authorization credentials
        res.sendStatus(200);
      } else if (req.query['q'] !== undefined) {
        const query = req.query['q'];

        if (typeof query !== 'string') {
          return badRequest(res, 'Invalid q parameter format');
        }

        if (!queryHandler) {
          if (query === 'config') { res.json({}); } else { badRequest(res, 'Queries are not supported'); }
          return;
        }

        // Using async IIFE — Express 4.x doesn't support async middleware natively
        (async () => {
          const result = await queryHandler(query, req);

          if (!result) {
            return query === 'config' ? res.json({}) : badRequest(res, 'Query type is not supported');
          }

          res.format({
            'application/json': () => { res.json(result); },
            'application/x-www-form-urlencoded': () => {
              res.type('application/x-www-form-urlencoded').send(queryStringEncodeWithArrayBrackets(result));
            },
            'default': () => { res.json(result); },
          });
          // eslint-disable-next-line promise/prefer-await-to-then -- Express 4.x doesn't support async middleware
        })().catch(/** @param {Error} err */ (err) => {
          // eslint-disable-next-line promise/no-callback-in-promise
          next(new Error('Error in query handling', { cause: err }));
        });
      } else {
        return badRequest(res, 'No known query parameters');
      }
    }
  );

  router.post('/',
    /**
     * @param {Request} req
     * @param {Response} res
     * @param {import('express').NextFunction} next
     * @returns {void}
     */
    (req, res, next) => {
      if (req.query['q']) {
        return badRequest(res, 'Queries only supported with GET method', 405);
      }

      /** @type {ParsedMicropubStructure} */
      const body = req.body;

      if (body.mp && body.mp['action']) {
        return badRequest(res, 'This endpoint does not yet support updates.', 501);
      } else if (!body.type) {
        return badRequest(res, 'Missing "h" value.');
      }

      if (!body.properties) {
        return badRequest(res, 'Not finding any properties.');
      }

      // Using async IIFE — Express 4.x doesn't support async middleware natively
      (async () => {
        const result = await handler(body, req);

        if (!result || !result.url) {
          return res.sendStatus(400);
        }

        return res.redirect(201, result.url);
        // eslint-disable-next-line promise/prefer-await-to-then -- Express 4.x doesn't support async middleware
      })().catch(/** @param {Error} err */ (err) => {
        // eslint-disable-next-line promise/no-callback-in-promise
        next(new Error('Error in post handling', { cause: err }));
      });
    }
  );

  return router;
}

micropubExpress.processFormEncodedBody = processFormEncodedBody;
micropubExpress.processJsonEncodedBody = processJsonEncodedBody;
micropubExpress.queryStringEncodeWithArrayBrackets = queryStringEncodeWithArrayBrackets;

export default micropubExpress;

// Also export as named for ESM consumers

export { processFormEncodedBody, queryStringEncodeWithArrayBrackets, processJsonEncodedBody } from './lib/core.js';
