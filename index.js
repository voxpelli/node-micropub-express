/* jshint node: true */

'use strict';

var qs = require('querystring');

var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer');

var fetch = require('node-fetch');

var pkg = require('./package.json');
var defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

var formEncodedKey = /\[([^\]]*)\]$/;

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
  'q',
  'url',
  'update',
  'add',
  'delete',
]);

var cleanEmptyKeys = function (result) {
  for (var key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }
};

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

  var key, subKey, value, targetProperty, tmp;

  for (key in body) {
    value = body[key];

    if (reservedProperties.indexOf(key) !== -1) {
      result[key] = value;
    } else {
      while ((subKey = formEncodedKey.exec(key))) {
        if (subKey[1]) {
          tmp = {};
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

var processJSONencodedBody = function (body) {
  var key, value;

  var result = {
    properties: {},
    mp: {},
  };

  for (key in body) {
    value = body[key];

    if (reservedProperties.indexOf(key) !== -1 || ['properties', 'type'].indexOf(key) !== -1) {
      result[key] = value;
    } else if (key.indexOf('mp-') === 0) {
      key = key.substr(3);
      result.mp[key] = [].concat(value);
    }
  }


  for (key in body.properties) {
    if (['url'].indexOf(key) !== -1) {
      result[key] = result[key] || [].concat(body.properties[key])[0];
      delete body.properties[key];
    }
  }

  cleanEmptyKeys(result);

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

  if (!options.syndication || options.syndication.constructor !== Array) {
    options.syndication = [];
  }

  var userAgent = ((options.userAgent || '') + ' ' + defaultUserAgent).trim();

  var tokenReference = typeof options.tokenReference === 'function' ? options.tokenReference : function () {
    return Promise.resolve(options.tokenReference);
  };

  // Helper functions

  var matchAnyTokenReference = function (token, references) {
    if (!references || !references.length) {
      return Promise.resolve(false);
    }

    var endpoints = {};

    references.forEach(function (reference) {
      endpoints[reference.endpoint] = endpoints[reference.endpoint] || [];
      endpoints[reference.endpoint].push(reference.me);
    });

    return Promise.all(Object.keys(endpoints).map(function (endpoint) {
      return validateToken(token, endpoints[endpoint], endpoint);
    })).then(function (result) {
      return result.some(function (valid) {
        return valid;
      });
    });
  };

  var validateToken = function (token, meReferences, endpoint) {
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

        meReferences = meReferences.map(normalizeUrl);

        if (meReferences.indexOf(normalizeUrl(result.me)) === -1) {
          logger.debug('Token "me" didn\'t match any of: "' + meReferences.join('", "') + '", Got: "' + result.me + '"');
          return false;
        }

        var scopes = result.scope.split(',');
        if (scopes.indexOf('post') === -1) {
          logger.debug('Missing "post scope, instead got: ' + result.scope);
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

  var storage = multer.memoryStorage();
  var upload = multer({ storage: storage });

  router.use(upload.fields(['video', 'photo', 'audio', 'video[]', 'photo[]', 'audio[]'].map(function (type) {
    return { name: type };
  })));

  // Ensure the needed parts are there
  router.use(function (req, res, next) {
    logger.debug({ body: req.body }, 'Received a request');

    if (req.headers['content-type'] === 'application/json') {
      req.body = processJSONencodedBody(req.body);
    } else {
      req.body = processFormencodedBody(req.body);
    }

    if (req.files && Object.getOwnPropertyNames(req.files)[0]) {
      req.body = processFiles(req.body, req.files, logger);
    }

    logger.debug({ body: req.body }, 'Processed a request');

    var token;

    if (req.headers.authorization) {
      token = req.headers.authorization.trim().split(/\s+/)[1];
    } else if (!token && req.body.access_token) {
      token = req.body.access_token;
    }

    if (!token) {
      logger.debug('Got a request with a missing token');
      return badRequest(res, 'Missing "Authorization" header or body parameter.', 401);
    }

    Promise.resolve()
      .then(function () {
        // This way the function doesn't have to return a Promise
        return tokenReference(req);
      })
      .then(function (tokenReference) {
        return matchAnyTokenReference(token, [].concat(tokenReference));
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

  router.get('/', function (req, res) {
    // If we've gotten this far then token gives proper access and that's all that this route care about
    var isSyndicationRequest = (req.query.q === 'syndicate-to');
    logger.debug({'query': req.query}, 'Received a query');

    if (isSyndicationRequest) {
      res.type('application/x-www-form-urlencoded');
      var data = '';
      for (var i = options.syndication.length - 1; i >= 0; i--) {
        var syndicateTo = options.syndication[i];
        data += 'syndicate-to[]=' + syndicateTo + '&';
      }
      res.format({
        'application/x-www-form-urlencoded': function () {
          return res.send(encodeURI(data));
        },

        'default': function () {
          // If not requesting form urlencoded then return error
          return badRequest(res, 'Requires application/x-www-form-urlencoded data', 406);
        }
      });
    } else {
      return res.sendStatus(200);
    }
  });

  router.post('/', function (req, res, next) {
    if (req.body.mp && req.body.mp.action) {
      return badRequest(res, 'This endpoint does not yet support updates.', 501);
    } else if (!req.body.type) {
      return badRequest(res, 'Missing "h" value.');
    }

    var data = req.body;

    if (!data.properties) {
      return badRequest(res, 'Not finding any properties.');
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
module.exports.processJSONencodedBody = processJSONencodedBody;
