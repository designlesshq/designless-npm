/**
 * @designless/annotate - package entry.
 *
 * Re-exports the public surface: the frozen contract (the marker shape every
 * reader can rely on) and the engine factories. Build tools import the engine
 * they need by subpath (`@designless/annotate/babel`, `@designless/annotate/next`);
 * this barrel is for tooling that wants the contract constants directly.
 */
'use strict';

const contract = require('./contract');

module.exports = {
  MARKER_VERSION: contract.MARKER_VERSION,
  ATTR: contract.ATTR,
  babel: require('./babel'),
  withDesignless: require('./next'),
};
