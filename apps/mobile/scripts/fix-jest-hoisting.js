#!/usr/bin/env node
/**
 * npm's workspace hoisting puts `@react-native/jest-preset` and
 * `expo-modules-core` at the monorepo root's node_modules (nothing else in
 * this workspace conflicts, so there's no reason for npm to nest them) —
 * but `react-native` itself stays nested here in apps/mobile/node_modules
 * (this monorepo's web app pulls in a different React major version, which
 * blocks react-native from hoisting). `@react-native/jest-preset` then does
 * a plain `require('react-native')` relative to *its own* install location,
 * which fails when it sits at the root and react-native doesn't.
 *
 * Metro (the app's real bundler) has its own hierarchical resolver and
 * isn't affected — this only breaks `npm test` after a fresh install. This
 * script runs on postinstall and copies both packages down into this
 * workspace's own node_modules, next to react-native, so Jest's plain
 * Node resolution finds everything it needs. Safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // monorepo root
const LOCAL = path.resolve(__dirname, '..', 'node_modules'); // apps/mobile/node_modules

const PACKAGES = ['@react-native/jest-preset', 'expo-modules-core'];

for (const pkg of PACKAGES) {
  const localPath = path.join(LOCAL, pkg);
  if (fs.existsSync(path.join(localPath, 'package.json'))) continue; // already local

  const rootPath = path.join(ROOT, 'node_modules', pkg);
  if (!fs.existsSync(path.join(rootPath, 'package.json'))) continue; // nothing to copy (different install layout)

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.cpSync(rootPath, localPath, { recursive: true });
  console.log(`[fix-jest-hoisting] Copied ${pkg} into apps/mobile/node_modules`);
}
