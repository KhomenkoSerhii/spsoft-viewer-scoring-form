const base = require('../jest.config.base.js');
const pkg = require('./package.json');

module.exports = {
  ...base,
  displayName: pkg.name,
  testEnvironment: 'node',
  reporters: ['default'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { rootMode: 'upward' }],
  },
};
