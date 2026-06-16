#!/usr/bin/env node
// Runs the Playwright suite using the already-installed global @playwright/cli
// (which bundles Playwright + the Firefox browser). No local @playwright/test
// install is required: NODE_PATH points module resolution at the bundled copy,
// and tests/config import from `playwright/test`.
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function globalRoot() {
  try {
    return execSync('npm root -g', { encoding: 'utf8' }).trim();
  } catch {
    return '/usr/local/lib/node_modules';
  }
}

const cliBase = path.join(globalRoot(), '@playwright', 'cli', 'node_modules');
const cliJs = path.join(cliBase, 'playwright', 'cli.js');

if (!fs.existsSync(cliJs)) {
  console.error(`Could not find the bundled Playwright CLI at:\n  ${cliJs}`);
  console.error('Expected @playwright/cli to be installed globally (npm ls -g @playwright/cli).');
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_PATH: cliBase + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : ''),
};

const args = [cliJs, 'test', ...process.argv.slice(2)];
const res = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
});
process.exit(res.status == null ? 1 : res.status);
