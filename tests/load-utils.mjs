import ts from 'typescript';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadUtils() {
  const dir = mkdtempSync(join(tmpdir(), 'docgen-tests-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const name of ['uuid', 'drafts', 'calculations']) {
      const source = readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8');
      const { outputText } = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext
      } });
      writeFileSync(join(dir, `${name}.js`), outputText.replace("from './uuid'", "from './uuid.js'"));
    }
    return {
      drafts: await import(pathToFileURL(join(dir, 'drafts.js')).href),
      calculations: await import(pathToFileURL(join(dir, 'calculations.js')).href),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function loadWhatsAppService() {
  const source = readFileSync(new URL('../src/services/whatsappService.ts', import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext
  } });
  // Isolate transport/state behavior from the live Supabase and CRM services.
  const stubs = {
    './apiAuth': "export async function authenticatedHeaders() { return { Authorization: 'Bearer test-token' }; }",
    './db': 'export const supabase = null; export const isCloudActive = () => false; export const dbService = {};',
    '../utils/whatsappShare': 'export const normalizeIndianPhone = x => x;',
    '../utils/calculations': 'export const normalizeAdvance = x => Number(x) || 0; export const calculateBalanceDue = (x,y) => x-y;',
    './leadService': 'export const leadService = { addLeadActivity: async () => {} };',
  };
  for (const [specifier, code] of Object.entries(stubs)) {
    outputText = outputText.replace(`'${specifier}'`, JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).whatsappService;
}
