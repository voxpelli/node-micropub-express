# Micropub Express

[![Build Status](https://travis-ci.org/voxpelli/node-micropub-express.svg?branch=master)](https://travis-ci.org/voxpelli/node-micropub-express)
[![Coverage Status](https://coveralls.io/repos/voxpelli/node-micropub-express/badge.svg)](https://coveralls.io/r/voxpelli/node-micropub-express)
[![Dependency Status](https://gemnasium.com/voxpelli/node-micropub-express.svg)](https://gemnasium.com/voxpelli/node-micropub-express)

Provides a Micropub route for Express 4.x

## Requirements

Requires io.js or Node 0.12

## Installation

```bash
npm install micropub-express --save
```

## Current status

**Early alpha**

Supported:

* Creation of content based items and creation of likes

The rest of the CRUD-operations + other more complex operations are yet to be built and the API might change to adopt to the requirements of those. Versioning will stick to Semantic Versioning to clearly communicate such breaking changes.

## Usage

```javascript
var micropub = require('micropub-express');

// Attach the micropub endpoint to "/micropub" or wherever else you want
app.use('/micropub', micropub({

  // Specify what endpoint you want to verify a token with and what the expected identity returned is
  tokenReference: {
    me: 'http://example.com/',
    endpoint: 'https://tokens.indieauth.com/token',
  },

  // And lastly: Do something with the created micropub document
  handler: function (micropubDocument, req) {
    // Do something with the micropubDocument and return a Promise to communicate status of the handling
    return Promise.resolve().then(function () {
      return { url: 'http://example.com/url/to/new/post' };
    });
  }

}));
```

## Advanced Usage

```javascript
var express = require('express');
var micropub = require('micropub-express');

var app = express();

// Do some Express magic to support multiple Micropub endpoints in the same application
app.param('targetsite', function (req, res, next, id) {
  // Resolve a token reference from the "targetsite" id and return 404 if you find no match
  if (id === 'example.com') {
    req.targetsite = {
      me: 'http://example.com/',
      endpoint: 'https://tokens.indieauth.com/token',
    };
    next();
  } else {
    res.sendStatus(404);
  }
});

app.use('/micropub/:targetsite', micropub({
  logger: logger,          // a logger object that uses the same API as the bunyan module
  userAgent: 'my-app/1.0', // a user-agent that will be prepended to the module's own user-agent to indicate
                           // to IndieAuth endpoints who it is that makes the verification requests
  tokenReference: function (req) {
    // Find the token reference we added to the request object before and return it
    return req.targetsite;
  },
  // And lastly: Do something with the created micropub document
  handler: function (micropubDocument, req) {
    // Do something with the micropubDocument and return a Promise to communicate status of the handling
    return Promise.resolve().then(function () {
      return { url: 'http://example.com/url/to/new/post' };
    });
  }
}));

// Start the Express server on a port, like port 3000!
app.listen(3000);
```

## Options

* **tokenReference** – *required* – either an object with two keys, `me` and `endpoint`, or a function that receives the request object and returns an object with those two keys. The `me` key signify what identity it is that's expected for a succesful authorization and the `endpoint` key indicates what endpoint the token should be verified with. Can also be or return an array of multiple references.
* **handler** – *required* – the function that will be called with the handled micropub document and the request object. It's this functions responsibility to actually act on the received data and do something with it. Should return a `Promise` resolving to an object with a `url` key containing the url of the created item to indicate success. If the `Promise` is rejected or the `url` key is missing or falsy in the resolved `Promise`, then a `400` error will be returned to indicate failure.
* **userAgent** – *recommended* – a user-agent *string* like `your-app-name/1.2.3 (http://app.example.com/)` that gets prepended to the user-agent of `micropub-express` itself when verifying received tokens against an endpoint
* **queryHandler** – *optional* – a function that will be called whenever a `?q=` query is made to the Micropub endpoint. It's this functions responsibility to execute the query and respond with the relevant data. Should return a `Promise` resolving to an object containing the query result. Keys on the object should _not_ include any `[]`, those will be added in the encoded result where relevant. If the `Promise` resolves to something falsy, then a `400` error will be returned to indicate that the query type is unsupported. If the `Promise` is rejected, then a `400` error will be returned to indicate failure.
* **logger** – *optional* – a [bunyan](https://github.com/trentm/node-bunyan) compatible logger, like bunyan itself or some other module. Defaults to [bunyan-duckling](https://github.com/bloglovin/node-bunyan-duckling) which logs with `console.log()` and `console.error()`

## Format of `micropubDocument`

The format closely matches the [JSON-representation](http://indiewebcamp.com/Micropub#JSON_Syntax) of Micropub.

It contains three top level keys:

* **type** – an array containing the type that is that's going to be created. Eg. `['h-entry']`
* **properties** – an object containing all of the microformat properties of the document as arrays containing strings. Eg. `content: ['foobar']`
* **mp** – an object containing all of the micropub directives as arrays containing string. Eg. `'syndicate-to': ['http://twitter.com/example']` for an `'mp-syndicate-to'` directive.
* **files** – an object that can contain three keys, `audio`, `video`, `photo`, which in turn contains arrays of objects with a `filename` and a `buffer` key with the name and content of the files.

Full example:

```javascript
{
  type: ['h-entry'],
  properties: {
    content: ['hello world'],
  },
  mp: {
    'syndicate-to': ['http://twitter.com/example'],
  },
  files: {
    photo: [
      {
        filename: 'example.jpg',
        buffer: new Buffer() // A Node.js buffer with the content of the file.
      }
    ]
  }
}
```

## Other useful modules

* [format-microformat](https://github.com/voxpelli/node-format-microformat) – a module that takes a `micropubDocument` as its input and then formats filenames, URL:s and file content from that data so one gets some standard data which one then can publish elsewhere – like to a Jekyll blog or something.
* [github-publish](https://github.com/voxpelli/node-github-publish) – a module that takes a filename and content and publishes that to a GitHub repository. A useful place to send the formatted data that comes out of `format-microformat` if one wants to add it to a GitHub hosted Jekyll blog of some kind, like eg. [GitHub Pages](https://pages.github.com/).
