// @ts-check
/// <reference types="node" />

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node:querystring';

import nock from 'nock';
import request from 'supertest';
import createBunyanAdaptor from 'bunyan-adaptor';
import express from 'express';

import micropub from '../../index.js';

/** @typedef {import('nock').Scope} NockScope */

describe('Micropub API', function () {
  let app;
  /** @type {import('supertest').Agent} */
  let agent;
  /** @type {string} */
  let token;
  /** @type {import('../../index.js').TokenReferenceOption} */
  let tokenReference;
  /** @type {ReturnType<typeof mock.fn>} */
  let handlerStub;
  /** @type {ReturnType<typeof mock.fn>} */
  let queryHandlerStub;

  const customLogger = createBunyanAdaptor({ verbose: function () {} });

  /**
   * @param {number} code
   * @param {string} response
   * @returns {NockScope}
   */
  const mockTokenEndpoint = function (code, response) {
    return nock('https://tokens.indieauth.com/')
      .get('/token')
      .reply(
        code || 200,
        response || 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post',
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
  };

  /**
   * @template {string} T
   * @param {T} message
   * @returns {{ error: 'invalid_request', error_description: T }}
   */
  const badRequestBody = (message) => ({
    error: 'invalid_request',
    error_description: message
  });

  /**
   * @param {undefined|false} [_mock]
   * @param {undefined|false} [_done]
   * @param {number} [code]
   * @param {string|Object<string,any>|((req: import('supertest').Test) => import('supertest').Test)} [content]
   * @param {*} [response]
   * @returns {import('supertest').Test}
   */
  const doRequest = function (_mock, _done, code, content, response) {
    let req = agent
      .post('/micropub')
      .set('Authorization', 'Bearer ' + token);

    if (typeof content === 'function') {
      req = content(req);
    } else {
      req = req
        .type('form')
        .send(content || {
          h: 'entry',
          content: 'hello world'
        });
    }

    if (response) {
      req = req.expect(code || 201, response);
    } else {
      req = req.expect(code || 201);
    }

    return req;
  };

  /**
   * @param {NockScope|undefined} nockMock
   * @param {number} [code]
   * @param {*} [content]
   * @param {*} [response]
   * @returns {Promise<void>}
   */
  const asyncRequest = async function (nockMock, code, content, response) {
    const req = doRequest(undefined, undefined, code, content, response);
    await req;
    if (nockMock) { nockMock.done(); }
  };

  beforeEach(function () {
    nock.disableNetConnect();

    // Needed so that supertest can connect to its own temporary local servers
    // Without it things blows up in a not so easy to debug way
    nock.enableNetConnect('127.0.0.1');

    token = 'abc123';

    tokenReference = {
      me: 'http://kodfabrik.se/',
      endpoint: 'https://tokens.indieauth.com/token'
    };

    handlerStub = mock.fn(() => Promise.resolve({
      url: 'http://example.com/new/post'
    }));

    queryHandlerStub = mock.fn(() => Promise.resolve({
      'syndicate-to': ['https://example.com/twitter', 'https://example.com/fb']
    }));

    app = express();
    app.use('/micropub', micropub({
      logger: customLogger,
      handler: handlerStub,
      queryHandler: queryHandlerStub,
      tokenReference
    }));

    agent = request.agent(app);
  });

  afterEach(function () {
    nock.cleanAll();
    mock.restoreAll();
  });

  describe('basics', function () {
    /** @type {NockScope} */
    let nockMock;

    beforeEach(function () {
      nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should accept a param-less GET-request', async function () {
      await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .expect(200);
      nockMock.done();
    });

    it('should not accept GET-request with unknown params', async function () {
      await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ foo: 'bar' })
        .expect(400, badRequestBody('No known query parameters'));
      nockMock.done();
    });

    it('should require authorization', async () => {
      await agent
        .post('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));
    });

    it('should also require authorization on GET', async () => {
      await agent
        .get('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));
    });
  });

  describe('auth', function () {
    it('should call handler and return 201 on successful request', async function () {
      const nockMock = nock('https://tokens.indieauth.com/')
        .matchHeader('Authorization', 'Bearer ' + token)
        .matchHeader('Content-Type', 'application/x-www-form-urlencoded')
        .matchHeader('User-Agent', /^micropub-express\/[\d.]+ \(http[^)]+\)$/)
        .get('/token')
        .reply(
          200,
          'me=http%3A%2F%2Fkodfabrik.se%2F&issued_by=https%3A%2F%2Ftokens.indieauth.com%2Ftoken&client_id=http%3A%2F%2F127.0.0.1%3A8080%2F&issued_at=1435611612&scope=post&nonce=501574078',
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );

      await asyncRequest(nockMock);
    });

    it('should return error on invalid token', async function () {
      const nockMock = mockTokenEndpoint(400, 'error=unauthorized&error_description=The+token+provided+was+malformed');
      await asyncRequest(nockMock, 403, undefined, {
        error: 'forbidden',
        error_description: 'Invalid token'
      });
    });

    it('should return error on mismatching me', async function () {
      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fvoxpelli.com%2F&scope=post');
      await asyncRequest(nockMock, 403, undefined, {
        error: 'forbidden',
        error_description: 'Token "me" didn\'t match any valid reference. Got: "http://voxpelli.com/"'
      });
    });

    it('should return error on missing "create" scope', async function () {
      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=misc');
      await asyncRequest(nockMock, 401, undefined, {
        error: 'insufficient_scope',
        error_description: 'Missing "create" scope, instead got: misc',
        scope: 'create'
      });
    });

    it('should support "create" scope', async function () {
      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=create');
      await asyncRequest(nockMock);
    });

    it('should handle multiple scopes', async function () {
      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
      await asyncRequest(nockMock);
    });

    it('should handle space-separated scopes', async function () {
      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post%20misc');
      await asyncRequest(nockMock);
    });

    it('should handle multiple token references', async function () {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        tokenReference: function () {
          return [
            { endpoint: 'https://tokens.indieauth.com/token', me: 'http://kodfabrik.se/' },
            { endpoint: 'https://tokens.indieauth.com/token', me: 'http://example.com/' }
          ];
        }
      }));

      agent = request.agent(app);

      const nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fexample.com%2F&scope=post,misc');

      await asyncRequest(nockMock);
    });

    it('should use custom user agent', async function () {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        userAgent: 'foobar/1.0',
        tokenReference: {
          me: 'http://kodfabrik.se/',
          endpoint: 'https://tokens.indieauth.com/token'
        }
      }));

      agent = request.agent(app);

      const nockMock = nock('https://tokens.indieauth.com/')
        .matchHeader('User-Agent', /^foobar\/1\.0 micropub-express\/[\d.]+ \(http[^)]+\)$/)
        .get('/token')
        .reply(
          200,
          'me=http%3A%2F%2Fkodfabrik.se%2F&issued_by=https%3A%2F%2Ftokens.indieauth.com%2Ftoken&client_id=http%3A%2F%2F127.0.0.1%3A8080%2F&issued_at=1435611612&scope=post&nonce=501574078',
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );

      await asyncRequest(nockMock);
    });
  });

  describe('create', function () {
    /** @type {NockScope} */
    let nockMock;

    beforeEach(function () {
      nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should require h-field', async function () {
      await agent
        .post('/micropub')
        .set('Authorization', 'Bearer abc123')
        .expect(400, badRequestBody('Missing "h" value.'));
      nockMock.done();
    });

    it('should refuse update requests', async function () {
      await asyncRequest(nockMock, 501, { 'mp-action': 'edit' }, badRequestBody('This endpoint does not yet support updates.'));
    });

    it('should fail when no properties', async function () {
      await asyncRequest(nockMock, 400, {
        h: 'entry'
      }, badRequestBody('Not finding any properties.'));
    });

    it('should require authorization', async function () {
      await agent
        .post('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));

      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should not call handle on GET', async function () {
      await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .expect(200);

      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should call handle on content', async function () {
      const res = await doRequest()
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should call handle on like-of', async function () {
      await doRequest(false, false, 201, {
        h: 'entry',
        'like-of': 'http://example.com/liked/post'
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          'like-of': ['http://example.com/liked/post']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should handle totally random properties', async function () {
      await doRequest(false, false, 201, {
        h: 'entry',
        foo: '123'
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          foo: ['123']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should call handle on HTML content', async function () {
      await doRequest(false, false, 201, {
        h: 'entry',
        'content[html]': '<strong>Hi</strong>'
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          content: [{
            html: '<strong>Hi</strong>'
          }]
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should call handle on JSON payload', async function () {
      await doRequest(undefined, undefined, undefined, function (req) {
        return req.type('json').send({
          type: ['h-entry'],
          properties: {
            content: ['hello world']
          }
        });
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should call handle on multipart payload', async function () {
      await doRequest(undefined, undefined, undefined, function (req) {
        return req
          .field('h', 'entry')
          .field('content', 'hello world');
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should transform mp-* properties', async function () {
      await doRequest(false, false, 201, {
        h: 'entry',
        'mp-foo': 'bar',
        'like-of': 'http://example.com/liked/post'
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          'like-of': ['http://example.com/liked/post']
        },
        mp: {
          foo: ['bar']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });

    it('should transform mp-* properties in JSON payload', async function () {
      await doRequest(undefined, undefined, undefined, function (req) {
        return req.type('json').send({
          type: ['h-entry'],
          'mp-foo': 'bar',
          properties: {
            content: ['hello world']
          }
        });
      })
        .expect('Location', 'http://example.com/new/post');

      nockMock.done();

      assert.strictEqual(handlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.calls[0].arguments.length, 2);
      assert.deepStrictEqual(handlerStub.mock.calls[0].arguments[0], {
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        },
        mp: {
          foo: ['bar']
        }
      });
      assert.strictEqual(typeof handlerStub.mock.calls[0].arguments[1], 'object');
    });
  });

  describe('query', function () {
    /** @type {NockScope} */
    let nockMock;

    beforeEach(function () {
      nockMock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should fail on POST', async function () {
      await agent
        .post('/micropub')
        .query({ q: 'syndicate-to' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(405, badRequestBody('Queries only supported with GET method'));

      assert.strictEqual(queryHandlerStub.mock.callCount(), 0);
    });

    it('should fail on invalid query format', async () => {
      await agent
        .get('/micropub')
        .query({ q: ['syndicate-to', 'foo'] })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(400, badRequestBody('Invalid q parameter format'));

      assert.strictEqual(queryHandlerStub.mock.callCount(), 0);
    });

    it('should fail when no queryHandler has been specified', async function () {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        tokenReference
      }));

      agent = request.agent(app);

      await agent
        .get('/micropub')
        .query({ q: 'syndicate-to' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(400, badRequestBody('Queries are not supported'));
    });

    it('should require authorization', async function () {
      await agent
        .get('/micropub')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));

      assert.strictEqual(queryHandlerStub.mock.callCount(), 0);
    });

    it('should fail when queryHandler doesn\'t support the sent query', async function () {
      queryHandlerStub = mock.fn(() => Promise.resolve(false));

      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        queryHandler: queryHandlerStub,
        tokenReference
      }));

      agent = request.agent(app);

      await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ q: 'syndicate-to' })
        .send()
        .expect(400, badRequestBody('Query type is not supported'));

      nockMock.done();

      assert.strictEqual(queryHandlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should support empty config even when no queryHandler has been specified', async () => {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        tokenReference
      }));

      await request(app)
        .get('/micropub')
        .query({ q: 'config' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(200, {});
    });

    it('should support empty config even when queryHandler doesn\'t support the sent query', async () => {
      queryHandlerStub = mock.fn(() => Promise.resolve(false));

      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        queryHandler: queryHandlerStub,
        tokenReference
      }));

      await request(app)
        .get('/micropub')
        .query({ q: 'config' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(200, {});

      nockMock.done();
      assert.strictEqual(queryHandlerStub.mock.callCount(), 1);
      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should return form encoded response', async function () {
      const res = await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/x-www-form-urlencoded')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8');

      nockMock.done();

      assert.deepStrictEqual(
        { ...parse(res.text) },
        {
          'syndicate-to[]': [
            'https://example.com/twitter',
            'https://example.com/fb'
          ]
        }
      );

      assert.strictEqual(queryHandlerStub.mock.callCount(), 1);
      assert.strictEqual(queryHandlerStub.mock.calls[0].arguments.length, 2);
      assert.strictEqual(queryHandlerStub.mock.calls[0].arguments[0], 'syndicate-to');
      assert.strictEqual(typeof queryHandlerStub.mock.calls[0].arguments[1], 'object');

      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should support json response', async function () {
      const res = await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/json')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8');

      nockMock.done();

      assert.deepStrictEqual(
        JSON.parse(res.text),
        {
          'syndicate-to': [
            'https://example.com/twitter',
            'https://example.com/fb'
          ]
        }
      );

      assert.strictEqual(queryHandlerStub.mock.callCount(), 1);
      assert.strictEqual(queryHandlerStub.mock.calls[0].arguments.length, 2);
      assert.strictEqual(queryHandlerStub.mock.calls[0].arguments[0], 'syndicate-to');
      assert.strictEqual(typeof queryHandlerStub.mock.calls[0].arguments[1], 'object');

      assert.strictEqual(handlerStub.mock.callCount(), 0);
    });

    it('should prefer json', async function () {
      const res = await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8');

      nockMock.done();

      assert.deepStrictEqual(
        JSON.parse(res.text),
        {
          'syndicate-to': [
            'https://example.com/twitter',
            'https://example.com/fb'
          ]
        }
      );
    });

    it('should use json when no matches are detected', async function () {
      const res = await agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'text/plain')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8');

      nockMock.done();

      assert.deepStrictEqual(
        JSON.parse(res.text),
        {
          'syndicate-to': [
            'https://example.com/twitter',
            'https://example.com/fb'
          ]
        }
      );
    });
  });
});
