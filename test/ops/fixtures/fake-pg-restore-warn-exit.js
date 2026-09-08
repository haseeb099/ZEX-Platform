#!/usr/bin/env node
'use strict';
// Mimics pg_restore exiting non-zero with WARNING-only stderr (no "ERROR:" substring).
process.stderr.write('pg_restore: warning: errors ignored on restore: 3\n');
process.exit(1);
