/* jshint node: true */
/* global describe, it */

'use strict';

var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
chai.should();

describe('Micropub Parse', function () {

  var micropub = require('../');

  describe('Formencoded Body', function () {

    it('should be correctly parsed', function () {
      micropub.processFormencodedBody({
        h: 'entry',
        content: 'hello world',
        'mp-syndicate-to': 'http://twitter.com/voxpelli',
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world'],
        },
        mp: {
          'syndicate-to': ['http://twitter.com/voxpelli'],
        }
      });
    });

    it('should handle array properties', function () {
      micropub.processFormencodedBody({
        h: 'entry',
        content: 'hello world',
        'category[]': ['foo', 'bar'],
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world'],
          category: ['foo', 'bar'],
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
          content: ['hello world'],
        },
      }).should.deep.equal({
        type: ['h-entry'],
        properties: {
          content: ['hello world'],
        },
        mp: {
          'action': ['edit'],
        }
      });
    });

  });

});
