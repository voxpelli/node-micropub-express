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

Simple:

```javascript
var express = require('express');
var micropub = require('micropub-express');

var app = express();

// Attach the micropub endpoint to "/micropub" or wherever else you want
app.use('/micropub', micropub({

  // Specify what endpoint you want to verify a token with and what the expected identity returned is
  tokenReference: {
    me: 'http://example.com/',
    endpoint: 'https://tokens.indieauth.com/token',
  },

  // And lastly: Do something with the created micropub document
  handler: function (micropubDocument, req) {
    // Do something with the micropubDocument
  }

}));

// Start the Express server on a port, like port 3000!
app.listen(3000);
```

Advanced:

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
    // Do something with the micropubDocument
  }
}));

// Start the Express server on a port, like port 3000!
app.listen(3000);
```

