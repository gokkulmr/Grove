import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './git.ts';

export const defaults = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.cs', '.rb', '.swift', '.php'],
  denyPrefixes: [] as string[], maxFileBytes: 1048576, maxFiles: 20000, sourceSearch: false,
};
export type Policy = typeof defaults;
export function loadPolicy(home: string): Policy {
  let input: any;
  try { input = JSON.parse(readFileSync(join(home, 'policy.json'), 'utf8')); }
  catch (e: any) { if (e.code === 'ENOENT') return structuredClone(defaults); throw new Error('Cannot read valid policy.json'); }
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !Object.hasOwn(defaults, k))) throw new Error('Unknown or invalid policy setting');
  const policy = { ...structuredClone(defaults), ...input };
  if (!Array.isArray(policy.extensions) || policy.extensions.some((x: any) => typeof x !== 'string' || !defaults.extensions.includes(x))) throw new Error('Policy extensions must narrow the built-in source allowlist');
  if (!Array.isArray(policy.denyPrefixes) || policy.denyPrefixes.some((x: any) => typeof x !== 'string' || !x || x.startsWith('/') || x.includes('\\') || x.split('/').includes('..'))) throw new Error('denyPrefixes must contain relative paths');
  if (!Number.isInteger(policy.maxFileBytes) || policy.maxFileBytes < 1 || policy.maxFileBytes > defaults.maxFileBytes || !Number.isInteger(policy.maxFiles) || policy.maxFiles < 1 || policy.maxFiles > defaults.maxFiles || typeof policy.sourceSearch !== 'boolean') throw new Error('Invalid policy limits');
  return policy;
}
export const policyKey = (policy: Policy) => hash(JSON.stringify(policy));
export const denied = (path: string, policy: Policy) => policy.denyPrefixes.some(prefix => path === prefix.replace(/\/$/, '') || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
