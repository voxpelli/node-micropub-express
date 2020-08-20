// @ts-check
/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

'use strict';

const qs = require('querystring');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const should = chai.should();

const micropub = require('..');

describe('Micropub Parse', function () {
  describe('Form Encoded Body', function () {
    it('should be correctly parsed', function () {
      micropub.processFormEncodedBody({
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
      micropub.processFormEncodedBody({
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
      micropub.processFormEncodedBody({
        h: 'entry',
        'content[html]': 'hello world'
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: [{ html: 'hello world' }]
        }
      });
    });
  });

  describe('JSON-encoded Body', function () {
    it('should be correctly parsed', function () {
      micropub.processJsonEncodedBody({
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
          action: ['edit']
        }
      });
    });

    it('should convert URL-property to top-level property', function () {
      micropub.processJsonEncodedBody({
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

  describe('Form Encoded Response', function () {
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
        abc: true,
        // eslint-disable-next-line unicorn/no-null
        xyz: null,
        def: undefined,
        bar: [
          'foo',
          { abc: 'xyc' },
          { abc: '789' }
        ]
      });

      Object.assign({}, qs.parse(result)).should.deep.equal({
        foo: '123',
        abc: 'true',
        xyz: '',
        'bar[]': 'foo',
        'bar[][abc]': ['xyc', '789']
      });
    });

    it('should throw on invalid data value', function () {
      should.Throw(
        () => {
          micropub.queryStringEncodeWithArrayBrackets({
            'syndicate-to': [
              'foo',
              () => {}
            ]
          });
        },
        TypeError,
        'Invalid data type encountered: function'
      );
    });
  });
});
