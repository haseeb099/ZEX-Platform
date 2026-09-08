#!/usr/bin/env node
'use strict';

/**
 * Fail closed when ZEX_PLATFORM_IMAGE is missing or uses :latest.
 * Usage:
 *   node scripts/ops/validate-image-ref.js
 *   node scripts/ops/validate-image-ref.js registry/image:sha
 * Prefers CLI arg, then ZEX_PLATFORM_IMAGE env.
 * Exit 0 on success, 1 on failure. Never prints secret env values.
 */

const { validatePlatformImageRef, redactSecrets } = require('./lib/production-guards');

const imageArg = process.argv[2] || process.env.ZEX_PLATFORM_IMAGE;
const result = validatePlatformImageRef(imageArg);
if (!result.ok) {
  console.error(redactSecrets(result.error));
  process.exit(1);
}
console.log(`OK image ref accepted (${result.image.split('@')[0].replace(/:[^/]+$/, ':<tag>')})`);
process.exit(0);
