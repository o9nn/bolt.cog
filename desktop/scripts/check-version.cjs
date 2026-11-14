'use strict';
const { version } = require('../package.json');
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const expected = `desktop-v${version}`;
if (tag !== expected) {
  console.error(`Desktop release tag must be ${expected}; received an incompatible tag`);
  process.exitCode = 1;
} else {
  console.log(`Desktop release version verified: ${expected}`);
}
