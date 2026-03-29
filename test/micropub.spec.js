// @ts-check
/// <reference types="node" />

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import micropub from '../index.js';

/**
 * @param {string} str
 * @returns {Record<string, string | string[]>}
 */
function parseQueryString (str) {
  const params = new URLSearchParams(str);
  /** @type {Record<string, string | string[]>} */
  const result = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length === 1 ? /** @type {string} */ (values[0]) : values;
  }

  return result;
}

describe('Micropub Parse', function () {
  describe('Form Encoded Body', function () {
    it('should be correctly parsed', function () {
      assert.deepStrictEqual(
        micropub.processFormEncodedBody({
          h: 'entry',
          content: 'hello world',
          'mp-syndicate-to': 'http://twitter.com/voxpelli',
        }),
        {
          type: ['h-entry'],
          properties: {
            content: ['hello world'],
          },
          mp: {
            'syndicate-to': ['http://twitter.com/voxpelli'],
          },
        }
      );
    });

    it('should handle array properties', function () {
      assert.deepStrictEqual(
        micropub.processFormEncodedBody({
          h: 'entry',
          content: 'hello world',
          'category[]': ['foo', 'bar'],
        }),
        {
          type: ['h-entry'],
          properties: {
            content: ['hello world'],
            category: ['foo', 'bar'],
          },
        }
      );
    });

    it('should handle object properties', function () {
      assert.deepStrictEqual(
        micropub.processFormEncodedBody({
          h: 'entry',
          'content[html]': 'hello world',
        }),
        {
          type: ['h-entry'],
          properties: {
            content: [{ html: 'hello world' }],
          },
        }
      );
    });
  });

  describe('JSON-encoded Body', function () {
    it('should be correctly parsed', function () {
      assert.deepStrictEqual(
        micropub.processJsonEncodedBody({
          type: ['h-entry'],
          'mp-action': 'edit',
          properties: {
            content: ['hello world'],
          },
        }),
        {
          type: ['h-entry'],
          properties: {
            content: ['hello world'],
          },
          mp: {
            action: ['edit'],
          },
        }
      );
    });

    it('should convert URL-property to top-level property', function () {
      assert.deepStrictEqual(
        micropub.processJsonEncodedBody({
          type: ['h-entry'],
          properties: {
            content: ['hello world'],
            url: ['http://example.com/'],
          },
        }),
        {
          type: ['h-entry'],
          url: 'http://example.com/',
          properties: {
            content: ['hello world'],
          },
        }
      );
    });
  });

  describe('Form Encoded Response', function () {
    it('should be correctly formatted', function () {
      const result = micropub.queryStringEncodeWithArrayBrackets({
        'syndicate-to': [
          'foo',
          'bar',
        ],
      });

      assert.deepStrictEqual(
        parseQueryString(result),
        {
          'syndicate-to[]': [
            'foo',
            'bar',
          ],
        }
      );
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
          { abc: '789' },
        ],
      });

      assert.deepStrictEqual(
        parseQueryString(result),
        {
          foo: '123',
          abc: 'true',
          xyz: '',
          'bar[]': 'foo',
          'bar[][abc]': ['xyc', '789'],
        }
      );
    });

    it('should throw on invalid data value', function () {
      assert.throws(
        () => {
          micropub.queryStringEncodeWithArrayBrackets({
            'syndicate-to': [
              'foo',
              () => {},
            ],
          });
        },
        {
          name: 'TypeError',
          message: 'Invalid data type encountered: function',
        }
      );
    });
  });
});
