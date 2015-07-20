/* jshint node: true */

'use strict';

var qs = require('querystring');

var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer');

var fetch = require('node-fetch');

var pkg = require('./package.json');
var defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

var badRequest = function (res, reason, code) {
  res.status(code || 400).set('Content-Type', 'text/plain').send(reason);
};

var normalizeUrl = function (url) {
  if (url.substr(-1) !== '/') {
    url += '/';
  }
  return url;
};

var reservedProperties = Object.freeze([
  'access_token',
  'h',
  'q',
  'edit-of',
  'delete-of',
  'update',
  'add',
  'delete',
]);

var processFormencodedBody = function (body) {
  var result = {
    type: body.h ? ['h-' + body.h] : undefined,
    properties: {},
    mp: {},
  };

  if (body.h) {
    result.type = ['h-' + body.h];
    delete body.h;
  }

  var key, value, targetProperty;

  for (key in body) {
    value = body[key];

    if (reservedProperties.indexOf(key) !== -1) {
      result[key] = value;
    } else {
      if (key.substr(-2) === '[]') {
        key = key.slice(0, -2);
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

  for (key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }

  return result;
};

var processFiles = function (body, files, logger) {
  var allResults = {};

  ['video', 'photo', 'audio'].forEach(function (type) {
    var result = [];

    ([].concat(files[type] || [], files[type + '[]'] || [])).forEach(function (file) {
      if (file.truncated) {
        logger.warn('File was truncated');
        return;
      }

      result.push({
        filename: file.originalname,
        buffer: file.buffer,
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

  var logger = options.logger || require('bunyan-duckling');

  if (!options.tokenReference || ['function', 'object'].indexOf(typeof options.tokenReference) === -1) {
    throw new Error('No correct token set. It\'s needed for authorization checks.');
  }
  if (!options.handler || typeof options.handler !== 'function') {
    throw new Error('No correct handler set. It\'s needed to actually process a Micropub request.');
  }

  var userAgent = ((options.userAgent || '') + ' ' + defaultUserAgent).trim();

  var tokenReference = typeof options.tokenReference === 'function' ? options.tokenReference : function () {
    return Promise.resolve(options.tokenReference);
  };

  // Helper functions

  var validateToken = function (token, me, endpoint) {
    if (!token) {
      return Promise.resolve(false);
    }

    var fetchOptions = {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
        },
      };

    return fetch(endpoint, fetchOptions)
      .then(function (response) {
        return response.text();
      }).then(function (body) {
        return qs.parse(body);
      }).then(function (result) {
        if (!result.me || !result.scope) {
          return false;
        }

        if (normalizeUrl(result.me) !== normalizeUrl(me)) {
          return false;
        }

        var scopes = result.scope.split(',');
        if (scopes.indexOf('post') === -1) {
          return false;
        }

        return true;
      });
  };

  // Router setup

  var router = express.Router({
    caseSensitive: true,
    mergeParams: true,
  });

  router.use(bodyParser.urlencoded({ extended: false }));
  router.use(bodyParser.json());
  router.use(multer({
    inMemory: true,
    putSingleFilesInArray: true,
  }));

  // Ensure the needed parts are there
  router.use(function (req, res, next) {
    if (req.headers['content-type'] !== 'application/json') {
      req.body = processFormencodedBody(req.body);
    }

    if (req.files && Object.getOwnPropertyNames(req.files)[0]) {
      req.body = processFiles(req.body, req.files, logger);
    }

    logger.debug({
      body: req.body,
      files: req.files,
    }, 'Received a request');

    var isUpdate = !!req.body['edit-of'];
    var isDeletion = !!req.body['delete-of'];

    //TODO: The body sniffing belongs in the actual route, not in the middleware – right?

    if (!req.headers.authorization && !req.body.access_token) {
      return badRequest(res, 'Missing "Authorization" header or body parameter.', 401);
    } else if (isUpdate) {
      return badRequest(res, 'This endpoint does not yet support updates.', 501);
    } else if (isDeletion) {
      return badRequest(res, 'This endpoint does not yet support deletions.', 501);
    } else if (!req.body.type) {
      return badRequest(res, 'Missing "h" value.');
    }

    var token;

    if (req.headers.authorization) {
      token = req.headers.authorization.trim().split(/\s+/)[1];
    }
    if (!token && req.body.access_token) {
      token = req.body.access_token;
    }

    Promise.resolve()
      .then(function () {
        // This way the function doesn't have to return a Promise
        return tokenReference(req);
      })
      .then(function (tokenReference) {
        return validateToken(token, tokenReference.me, tokenReference.endpoint);
      })
      .then(function (valid) {
        if (!valid) {
          return res.sendStatus(403);
        }
        next();
      })
      .catch(function (err) {
        logger.debug(err, 'An error occured when trying to validate token');
        next(err);
      });
  });

  router.post('/', function (req, res, next) {
    var data = req.body;

    if (!data.properties || !(data.properties.content || data.properties['like-of'])) {
      return badRequest(res, 'Missing "content" value.');
    }

    Promise.resolve()
      .then(function () {
        // This way the function doesn't have to return a Promise
        return options.handler(data, req);
      })
      .then(function (result) {
        if (!result || !result.url) {
          return res.sendStatus(400);
        } else {
          return res.redirect(201, result.url);
        }
      }).catch(function (err) {
        next(err);
      });

  });

  return router;
};

module.exports.processFormencodedBody = processFormencodedBody;
