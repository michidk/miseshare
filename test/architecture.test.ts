import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '../src');
const modules = ['chat-ui', 'drop', 'emotes', 'ice-config', 'media', 'room', 'room-api', 'rtc', 'signaling'];

test('feature modules expose internals only through their public entrypoints', () => {
  const violations: string[] = [];
  for (const filename of typescriptFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filename);
    const source = readFileSync(filename, 'utf8');
    for (const moduleName of modules) {
      if (relative.startsWith(`${moduleName}${path.sep}`)) continue;
      const internalImport = new RegExp(`(?:from\\s+|import\\s*\\()(['"]).*${moduleName}/internal/`);
      if (internalImport.test(source)) violations.push(`${relative} imports ${moduleName}/internal`);
    }
  }
  assert.deepEqual(violations, []);
});

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(filename) : entry.name.endsWith('.ts') ? [filename] : [];
  });
}
