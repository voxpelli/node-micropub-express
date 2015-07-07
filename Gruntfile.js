/*jslint node: true */
'use strict';

var lintlovin = require('lintlovin');

module.exports = function (grunt) {
  lintlovin.initConfig(grunt, {
    mocha_istanbul : {
      options: {
        ui: 'tdd',
        coverage: true,
        reportFormats: ['lcov']
      },
      basic: {
        src: process.env.TRAVIS ? ['test/**/*.js'] : ['test/**/*.js', '!test/integration/**/*.js']
      },
      integration: {
        src: ['test/integration/**/*.js']
      }
    }
  }, {
    integrationWatch: true,
    spaceFiles: ['!package.json'],
  });

  grunt.event.on('coverage', function (lcov, done) {
    if (!process.env.TRAVIS) { return done(); }

    require('coveralls').handleInput(lcov, function (err) {
      if (err) { return done(err); }
      done();
    });
  });
};
