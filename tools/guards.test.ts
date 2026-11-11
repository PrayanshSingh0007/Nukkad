import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Product rules that must never be broken by accident (PLAN §9).
 * These tests read our own source code and fail the build if a rule is broken.
 */
const root = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|html|css)$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(path.join(root, 'apps')), ...sourceFiles(path.join(root, 'packages'))];

describe('privacy and legal guards', () => {
  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never uses the Geolocation API (we must not know where a player really is)', () => {
    const offenders = files.filter((file) => /geolocation/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never loads Google maps, fonts or SDKs', () => {
    const offenders = files.filter((file) => /googleapis\.com|maps\.google|gstatic\.com/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
