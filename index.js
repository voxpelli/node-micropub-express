'use strict';

const qs = require('querystring');

const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');

const fetch = require('node-fetch');
const VError = require('verror');

const pkg = require('./package.json');
const defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

const requiredScope = ['create', 'post'];

const formEncodedKey = /\[([^\]]*)\]$/;

class TokenError extends Error {}
class TokenScopeError extends TokenError {
  constructor (message, scope) {
    super(message);
    this.scope = scope;
  }
}

const queryStringEncodeWithArrayBrackets = function (data, key) {
  if (Array.isArray(data)) {
    return data.map(item => queryStringEncodeWithArrayBrackets(item, key + '[]')).join('&');
  } else if (typeof data === 'object') {
    return Object.keys(data)
      .map(dataKey => queryStringEncodeWithArrayBrackets(data[dataKey], key ? key + '[' + dataKey + ']' : dataKey))
      .join('&');
  } else {
    return encodeURIComponent(key) + (data ? '=' + encodeURIComponent(data) : '');
  }
};

const badRequest = function (res, reason, code) {
  res.status(code || 400).json({
    error: 'invalid_request',
    error_description: reason
  });
};

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

const cleanEmptyKeys = function (result) {
  for (const key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }
};

const processFormencodedBody = function (body) {
  const result = {
    type: body.h ? ['h-' + body.h] : undefined,
    properties: {},
    mp: {}
  };

  if (body.h) {
    result.type = ['h-' + body.h];
    delete body.h;
  }

  for (let key in body) {
    let value = body[key];

    if (reservedProperties.indexOf(key) !== -1) {
      result[key] = value;
    } else {
      let subKey, targetProperty;

      while ((subKey = formEncodedKey.exec(key))) {
        if (subKey[1]) {
          const tmp = {};
          tmp[subKey[1]] = value;
          value = tmp;
        } else {
          value = [].concat(value);
        }
        key = key.slice(0, subKey.index);
      }

      if (key.indexOf('mp-') === 0) {
        key = key.substr(3);
        targetProperty = result.mp;
      } else {
        targetProperty = result.properties;
      }

      targetProperty[key] = [].concat(value);
    }
  }

  cleanEmptyKeys(result);

  return result;
};

const processJSONencodedBody = function (body) {
  const result = {
    properties: {},
    mp: {}
  };

  for (let key in body) {
    const value = body[key];

    if (reservedProperties.indexOf(key) !== -1 || ['properties', 'type'].indexOf(key) !== -1) {
      result[key] = value;
    } else if (key.indexOf('mp-') === 0) {
      key = key.substr(3);
      result.mp[key] = [].concat(value);
    }
  }

  for (let key in body.properties) {
    if (['url'].indexOf(key) !== -1) {
      result[key] = result[key] || [].concat(body.properties[key])[0];
      delete body.properties[key];
    }
  }

  cleanEmptyKeys(result);

  return result;
};

const processFiles = function (body, files, logger) {
  const allResults = {};

  ['video', 'photo', 'audio'].forEach(type => {
    const result = [];

    ([].concat(files[type] || [], files[type + '[]'] || [])).forEach(function (file) {
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
      allResults[type] = result;
    }
  });

  if (Object.getOwnPropertyNames(allResults)[0] !== undefined) {
    body.files = allResults;
  }

  return body;
};

module.exports = function (options) {
  options = options || {};

  const logger = options.logger || require('bunyan-duckling');

  if (!options.tokenReference || ['function', 'object'].indexOf(typeof options.tokenReference) === -1) {
    throw new Error('No correct token set. It\'s needed for authorization checks.');
  }

  if (!options.handler || typeof options.handler !== 'function') {
    throw new Error('No correct handler set. It\'s needed to actually process a Micropub request.');
  }

  const userAgent = ((options.userAgent || '') + ' ' + defaultUserAgent).trim();

  const tokenReference = typeof options.tokenReference === 'function' ? options.tokenReference : function () {
    return Promise.resolve(options.tokenReference);
  };

  // Helper functions

  const matchAnyTokenReference = function (token, references) {
    if (!references || !references.length) {
      return Promise.resolve(false);
    }

    const endpoints = {};

    references.forEach(reference => {
      endpoints[reference.endpoint] = endpoints[reference.endpoint] || [];
      endpoints[reference.endpoint].push(reference.me);
    });

    return Promise.all(
      Object.keys(endpoints)
        .map(endpoint => validateToken(token, endpoints[endpoint], endpoint))
    )
      .then(result =>
        result.some(valid => valid && !(valid instanceof Error)) ||
        result.find(valid => valid instanceof TokenScopeError) ||
        result[0]
      );
  };

  const validateToken = function (token, meReferences, endpoint) {
    if (!token) {
      return Promise.resolve(new TokenError('No token specified'));
    }

    const fetchOptions = {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent
      }
    };

    return fetch(endpoint, fetchOptions)
      .then(response => response.text())
      .then(body => qs.parse(body))
      .then(result => {
        if (!result.me || !result.scope) {
          return new TokenError('Invalid token');
        }

        meReferences = meReferences.map(normalizeUrl);

        if (meReferences.indexOf(normalizeUrl(result.me)) === -1) {
          logger.debug('Token "me" didn\'t match any of: "' + meReferences.join('", "') + '", Got: "' + result.me + '"');
          return new TokenError(`Token "me" didn't match any valid reference. Got: "${result.me}"`);
        }

        const scopeMatch = [' ', ','].some(separator => result.scope.split(separator).some(scope => requiredScope.includes(scope)));

        if (!scopeMatch) {
          const errMessage = `Missing "${requiredScope[0]}" scope, instead got: ${result.scope}`;
          logger.debug(errMessage);
          return new TokenScopeError(errMessage, requiredScope[0]);
        }

        return true;
      });
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
        req.body = processJSONencodedBody(req.body);
      } else {
        req.body = processFormencodedBody(req.body);
      }
    }

    if (req.files && Object.getOwnPropertyNames(req.files)[0]) {
      req.body = processFiles(req.body, req.files, logger);
    }

    logger.debug({ body: req.body }, 'Processed a request');

    let token;

    if (req.headers.authorization) {
      token = req.headers.authorization.trim().split(/\s+/)[1];
    } else if (!token && req.body && req.body.access_token) {
      token = req.body.access_token;
    }

    if (!token) {
      logger.debug('Got a request with a missing token');
      return badRequest(res, 'Missing "Authorization" header or body parameter.', 401);
    }

    Promise.resolve()
      // This way the function doesn't have to return a Promise
      .then(() => tokenReference(req))
      .then(tokenReference => matchAnyTokenReference(token, [].concat(tokenReference)))
      .then(valid => {
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
          error_description: (valid || {}).message || undefined
        });
      })
      .catch(err => {
        logger.debug(err, 'An error occured when trying to validate token');
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

      Promise.resolve()
        // This way the function doesn't have to return a Promise
        .then(() => options.queryHandler(req.query.q, req))
        .then(result => {
          if (!result) {
            return req.query.q === 'config' ? res.json({}) : badRequest(res, 'Query type is not supported');
          }

          res.format({
            'application/json': () => { res.json(result); },
            'application/x-www-form-urlencoded': () => {
              res.type('application/x-www-form-urlencoded').send(queryStringEncodeWithArrayBrackets(result));
            },
            'default': () => { res.json(result); }
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

    Promise.resolve()
      // This way the function doesn't have to return a Promise
      .then(() => options.handler(data, req))
      .then(result => {
        if (!result || !result.url) {
          return res.sendStatus(400);
        } else {
          return res.redirect(201, result.url);
        }
      })
      .catch(err => {
        next(new VError(err, 'Error in post handling'));
      });
  });

  return router;
};

module.exports.processFormencodedBody = processFormencodedBody;
module.exports.processJSONencodedBody = processJSONencodedBody;
module.exports.queryStringEncodeWithArrayBrackets = queryStringEncodeWithArrayBrackets;
