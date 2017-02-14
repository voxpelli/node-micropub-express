'use strict';

const qs = require('querystring');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
chai.should();

describe('Micropub Parse', function () {
  const micropub = require('../');

  describe('Formencoded Body', function () {
    it('should be correctly parsed', function () {
      micropub.processFormencodedBody({
        h: 'entry',
        content: 'hello world',
        'mp-syndicate-to': 'http://twitter.com/voxpelli'
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        },
        mp: {
          'syndicate-to': ['http://twitter.com/voxpelli']
        }
      });
    });

    it('should handle array properties', function () {
      micropub.processFormencodedBody({
        h: 'entry',
        content: 'hello world',
        'category[]': ['foo', 'bar']
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world'],
          category: ['foo', 'bar']
        }
      });
    });

    it('should handle object properties', function () {
      micropub.processFormencodedBody({
        h: 'entry',
        'content[html]': 'hello world'
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: [{'html': 'hello world'}]
        }
      });
    });
  });

  describe('JSON-encoded Body', function () {
    it('should be correctly parsed', function () {
      micropub.processJSONencodedBody({
        type: ['h-entry'],
        'mp-action': 'edit',
        properties: {
          content: ['hello world']
        }
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world']
        },
        mp: {
          'action': ['edit']
        }
      });
    });

    it('should convert URL-property to top-level property', function () {
      micropub.processJSONencodedBody({
        type: ['h-entry'],
        properties: {
          content: ['hello world'],
          url: ['http://example.com/']
        }
      }).should.deep.equal({
        type: ['h-entry'],
        url: 'http://example.com/',
        properties: {
          content: ['hello world']
        }
      });
    });
  });

  describe('Formencoded Response', function () {
    it('should be correctly formatted', function () {
      const result = micropub.queryStringEncodeWithArrayBrackets({
        'syndicate-to': [
          'foo',
          'bar'
        ]
      });

      Object.assign({}, qs.parse(result)).should.deep.equal({
        'syndicate-to[]': [
          'foo',
          'bar'
        ]
      });
    });

    it('should format complex variants', function () {
      const result = micropub.queryStringEncodeWithArrayBrackets({
        foo: 123,
        bar: [
          'foo',
          { abc: 'xyc' },
          { abc: '789' }
        ]
      });

      Object.assign({}, qs.parse(result)).should.deep.equal({
        foo: '123',
        'bar[]': 'foo',
        'bar[][abc]': ['xyc', '789']
      });
    });
  });
});
