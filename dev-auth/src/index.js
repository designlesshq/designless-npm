/**
 * @designless/dev-auth - package entry.
 *
 * Re-exports the core surface: the frozen contract constants, the fail-closed
 * receiver core, and the absence guard. Framework adapters are imported by
 * subpath (`@designless/dev-auth/express`, `/svelte`, `/nuxt`, `/next`); this
 * barrel is for code that wants the contract or the core directly.
 */

'use strict';

const contract = require('./contract');
const gate = require('./gate');
const guard = require('./guard');

module.exports = {
  CONTRACT_VERSION: contract.CONTRACT_VERSION,
  HEADER: contract.HEADER,
  isValidRole: contract.isValidRole,
  readBypassRole: gate.readBypassRole,
  isDevAuthEnabled: gate.isDevAuthEnabled,
  safeEqual: gate.safeEqual,
  detectDevAuthWiring: guard.detectDevAuthWiring,
  findDevAuthWiring: guard.findDevAuthWiring,
};
