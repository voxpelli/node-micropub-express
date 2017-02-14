'use strict';

const qs = require('querystring');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const nock = require('nock');
const request = require('supertest');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');

require('sinon-as-promised');

chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.should();

describe('Micropub API', function () {
  const customLogger = require('bunyan-adaptor')({ verbose: function () {} });
  const express = require('express');
  const micropub = require('../../');

  let app, agent, token, tokenReference, handlerStub, queryHandlerStub;

  const mockTokenEndpoint = function (code, response) {
    return nock('https://tokens.indieauth.com/')
      .get('/token')
      .reply(
        code || 200,
        response || 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post',
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
  };

  const badRequestBody = (message) => ({
    error: 'invalid_request',
    error_description: message
  });

  const doRequest = function (mock, done, code, content, response) {
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

    if (!done) {
      return req;
    }

    req.end(function (err) {
      if (err) { return done(err); }
      if (mock) { mock.done(); }
      done();
    });
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

    handlerStub = sinon.stub().resolves({
      url: 'http://example.com/new/post'
    });

    queryHandlerStub = sinon.stub().resolves({
      'syndicate-to': ['https://example.com/twitter', 'https://example.com/fb']
    });

    app = express();
    app.use('/micropub', micropub({
      logger: customLogger,
      handler: handlerStub,
      queryHandler: queryHandlerStub,
      tokenReference: tokenReference
    }));

    agent = request.agent(app);
  });

  afterEach(function () {
    nock.cleanAll();
  });

  describe('basics', function () {
    let mock;

    beforeEach(function () {
      mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should accept a param-less GET-request', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .expect(200, function (err) {
          mock.done();
          done(err);
        });
    });

    it('should not accept GET-request with unknown params', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ foo: 'bar' })
        .expect(400, badRequestBody('No known query parameters'), function (err) {
          mock.done();
          done(err);
        });
    });

    it('should require authorization', () => {
      return agent
        .post('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));
    });

    it('should also require authorization on GET', () => {
      return agent
        .get('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'));
    });
  });

  describe('auth', function () {
    it('should call handler and return 201 on successful request', function (done) {
      const mock = nock('https://tokens.indieauth.com/')
        .matchHeader('Authorization', function (val) { return val && val[0] === 'Bearer ' + token; })
        .matchHeader('Content-Type', function (val) { return val && val[0] === 'application/x-www-form-urlencoded'; })
        .matchHeader('User-Agent', function (val) { return val && /^micropub-express\/[0-9.]+ \(http[^)]+\)$/.test(val); })
        .get('/token')
        .reply(
          200,
          'me=http%3A%2F%2Fkodfabrik.se%2F&issued_by=https%3A%2F%2Ftokens.indieauth.com%2Ftoken&client_id=http%3A%2F%2F127.0.0.1%3A8080%2F&issued_at=1435611612&scope=post&nonce=501574078',
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );

      doRequest(mock, done);
    });

    it('should return error on invalid token', function (done) {
      const mock = mockTokenEndpoint(400, 'error=unauthorized&error_description=The+token+provided+was+malformed');
      doRequest(mock, done, 403, undefined, {
        error: 'forbidden',
        error_description: 'Invalid token'
      });
    });

    it('should return error on mismatching me', function (done) {
      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fvoxpelli.com%2F&scope=post');
      doRequest(mock, done, 403, undefined, {
        error: 'forbidden',
        error_description: 'Token "me" didn\'t match any valid reference. Got: "http://voxpelli.com/"'
      });
    });

    it('should return error on missing "create" scope', function (done) {
      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=misc');
      doRequest(mock, done, 401, undefined, {
        error: 'insufficient_scope',
        error_description: 'Missing "create" scope, instead got: misc',
        scope: 'create'
      });
    });

    it('should support "create" scope', function (done) {
      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=create');
      doRequest(mock, done);
    });

    it('should handle multiple scopes', function (done) {
      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
      doRequest(mock, done);
    });

    it('should handle space-separated scopes', function (done) {
      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post%20misc');
      doRequest(mock, done);
    });

    it('should handle multiple token references', function (done) {
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

      const mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fexample.com%2F&scope=post,misc');

      doRequest(mock, done);
    });

    it('should use custom user agent', function (done) {
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

      const mock = nock('https://tokens.indieauth.com/')
        .matchHeader('User-Agent', function (val) { return val && /^foobar\/1\.0 micropub-express\/[0-9.]+ \(http[^)]+\)$/.test(val); })
        .get('/token')
        .reply(
          200,
          'me=http%3A%2F%2Fkodfabrik.se%2F&issued_by=https%3A%2F%2Ftokens.indieauth.com%2Ftoken&client_id=http%3A%2F%2F127.0.0.1%3A8080%2F&issued_at=1435611612&scope=post&nonce=501574078',
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );

      doRequest(mock, done);
    });
  });

  describe('create', function () {
    let mock;

    beforeEach(function () {
      mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should require h-field', function (done) {
      agent
        .post('/micropub')
        .set('Authorization', 'Bearer abc123')
        .expect(400, badRequestBody('Missing "h" value.'), function (err) {
          mock.done();
          done(err);
        });
    });

    it('should refuse update requests', function (done) {
      doRequest(mock, done, 501, { 'mp-action': 'edit' }, badRequestBody('This endpoint does not yet support updates.'));
    });

    it('should fail when no properties', function (done) {
      doRequest(mock, done, 400, {
        h: 'entry'
      }, badRequestBody('Not finding any properties.'));
    });

    it('should require authorization', function (done) {
      agent
        .post('/micropub')
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'), function (err) {
          if (err) { return done(err); }

          handlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should not call handle on GET', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .expect(200, function (err) {
          if (err) { return done(err); }

          handlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should call handle on content', function (done) {
      doRequest()
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.should.have.been.calledOnce;
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              content: ['hello world']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should call handle on like-of', function (done) {
      doRequest(false, false, 201, {
        h: 'entry',
        'like-of': 'http://example.com/liked/post'
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.callCount.should.equal(1);
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              'like-of': ['http://example.com/liked/post']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should handle totally random properties', function (done) {
      doRequest(false, false, 201, {
        h: 'entry',
        foo: '123'
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.callCount.should.equal(1);
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              'foo': ['123']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should call handle on HTML content', function (done) {
      doRequest(false, false, 201, {
        h: 'entry',
        'content[html]': '<strong>Hi</strong>'
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.should.have.been.calledOnce;
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              content: [{
                html: '<strong>Hi</strong>'
              }]
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should call handle on JSON payload', function (done) {
      doRequest(undefined, undefined, undefined, function (req) {
        return req.type('json').send({
          type: ['h-entry'],
          properties: {
            content: ['hello world']
          }
        });
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.callCount.should.equal(1);
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              content: ['hello world']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should call handle on multipart payload', function (done) {
      doRequest(undefined, undefined, undefined, function (req) {
        return req
          .field('h', 'entry')
          .field('content', 'hello world');
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.should.have.been.calledOnce;
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              content: ['hello world']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should transform mp-* properties', function (done) {
      doRequest(false, false, 201, {
        h: 'entry',
        'mp-foo': 'bar',
        'like-of': 'http://example.com/liked/post'
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.callCount.should.equal(1);
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              'like-of': ['http://example.com/liked/post']
            },
            mp: {
              foo: ['bar']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });

    it('should transform mp-* properties in JSON payload', function (done) {
      doRequest(undefined, undefined, undefined, function (req) {
        return req.type('json').send({
          type: ['h-entry'],
          'mp-foo': 'bar',
          properties: {
            content: ['hello world']
          }
        });
      })
        .expect('Location', 'http://example.com/new/post')
        .end(function (err) {
          if (err) { return done(err); }

          mock.done();

          handlerStub.callCount.should.equal(1);
          handlerStub.firstCall.args.should.have.length(2);
          handlerStub.firstCall.args[0].should.deep.equal({
            type: ['h-entry'],
            properties: {
              content: ['hello world']
            },
            mp: {
              foo: ['bar']
            }
          });
          handlerStub.firstCall.args[1].should.be.an('object');

          done();
        });
    });
  });

  describe('query', function () {
    let mock;

    beforeEach(function () {
      mock = mockTokenEndpoint(200, 'me=http%3A%2F%2Fkodfabrik.se%2F&scope=post,misc');
    });

    it('should fail on POST', function (done) {
      agent
        .post('/micropub')
        .query({ q: 'syndicate-to' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(405, badRequestBody('Queries only supported with GET method'), function (err) {
          if (err) { return done(err); }

          queryHandlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should fail when no queryHandler has been specified', function (done) {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        tokenReference: tokenReference
      }));

      agent = request.agent(app);

      agent
        .get('/micropub')
        .query({ q: 'syndicate-to' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(400, badRequestBody('Queries are not supported'), done);
    });

    it('should require authorization', function (done) {
      agent
        .get('/micropub')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(401, badRequestBody('Missing "Authorization" header or body parameter.'), function (err) {
          if (err) { return done(err); }

          queryHandlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should fail when queryHandler doesn\'t support the sent query', function (done) {
      queryHandlerStub = sinon.stub().resolves(false);

      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        queryHandler: queryHandlerStub,
        tokenReference: tokenReference
      }));

      agent = request.agent(app);

      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ q: 'syndicate-to' })
        .send()
        .expect(400, badRequestBody('Query type is not supported'), function (err) {
          if (err) { return done(err); }

          mock.done();

          queryHandlerStub.should.have.been.calledOnce;

          handlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should support empty config even when no queryHandler has been specified', () => {
      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        tokenReference: tokenReference
      }));

      return request(app)
        .get('/micropub')
        .query({ q: 'config' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(200, {});
    });

    it('should support empty config even when queryHandler doesn\'t support the sent query', () => {
      queryHandlerStub = sinon.stub().resolves(false);

      app = express();
      app.use('/micropub', micropub({
        logger: customLogger,
        handler: handlerStub,
        queryHandler: queryHandlerStub,
        tokenReference: tokenReference
      }));

      return request(app)
        .get('/micropub')
        .query({ q: 'config' })
        .set('Authorization', 'Bearer ' + token)
        .send()
        .expect(200, {})
        .then(() => {
          mock.done();
          queryHandlerStub.should.have.been.calledOnce;
          handlerStub.should.not.have.been.called;
        });
    });

    it('should return form encoded response', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/x-www-form-urlencoded')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
        .end(function (err, res) {
          if (err) { return done(err); }

          mock.done();

          ({
            'syndicate-to[]': [
              'https://example.com/twitter',
              'https://example.com/fb'
            ]
          }).should.deep.equal(qs.parse(res.text));

          queryHandlerStub.should.have.been.calledOnce;
          queryHandlerStub.firstCall.args.should.have.length(2);
          queryHandlerStub.firstCall.args[0].should.equal('syndicate-to');
          queryHandlerStub.firstCall.args[1].should.be.an('object');

          handlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should support json response', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/json')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(function (err, res) {
          if (err) { return done(err); }

          mock.done();

          JSON.parse(res.text).should.deep.equal({
            'syndicate-to': [
              'https://example.com/twitter',
              'https://example.com/fb'
            ]
          });

          queryHandlerStub.should.have.been.calledOnce;
          queryHandlerStub.firstCall.args.should.have.length(2);
          queryHandlerStub.firstCall.args[0].should.equal('syndicate-to');
          queryHandlerStub.firstCall.args[1].should.be.an('object');

          handlerStub.should.not.have.been.called;

          done();
        });
    });

    it('should prefer json', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(function (err, res) {
          if (err) { return done(err); }

          mock.done();

          JSON.parse(res.text).should.deep.equal({
            'syndicate-to': [
              'https://example.com/twitter',
              'https://example.com/fb'
            ]
          });

          done();
        });
    });

    it('should use json when no matches are detected', function (done) {
      agent
        .get('/micropub')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'text/plain')
        .query({ q: 'syndicate-to' })
        .send()
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(function (err, res) {
          if (err) { return done(err); }

          mock.done();

          JSON.parse(res.text).should.deep.equal({
            'syndicate-to': [
              'https://example.com/twitter',
              'https://example.com/fb'
            ]
          });

          done();
        });
    });
  });
});
