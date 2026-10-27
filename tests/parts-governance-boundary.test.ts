import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { checkNativePairCollision } from '../src/parts/assembly/collision.js';
import { IDENTITY_TRANSFORM } from '../src/parts/assembly/math.js';
import { importReferenceModel } from '../src/automotive/references/importer.js';
import { analyzeReferenceModel } from '../src/automotive/references/analyzer.js';

/** Follow runtime imports, re-exports and literal dynamic imports, including barrels. */
async function runtimeClosure(entry: string): Promise<Set<string>> {
  const visited = new Set<string>();
  async function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const code = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const names = clause?.namedBindings;
        const typesOnly = clause?.isTypeOnly || (!clause?.name && names && ts.isNamedImports(names) && names.elements.length > 0 && names.elements.every(n => n.isTypeOnly));
        if (!typesOnly) imports.push(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const names = node.exportClause;
        if (!(names && ts.isNamedExports(names) && names.elements.length > 0 && names.elements.every(n => n.isTypeOnly))) imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        expect(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), `Nonliteral dynamic import in ${file}`).toBe(true);
        if (ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of imports.filter(name => name.startsWith('.'))) {
      const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'));
      if (target.endsWith('.ts')) await visit(target);
    }
  }
  await visit(path.resolve(entry));
  return visited;
}

describe('production digital-part architecture boundary', () => {
  it.each(['src/parts/api.ts', 'src/parts/assembly/service.ts', 'src/parts/assembly/source.ts'])(
    'G: %s has no transitive runtime dependency on legacy constructors, providers or generators', async entry => {
      const closure = [...await runtimeClosure(entry)].map(file => path.relative(process.cwd(), file).replaceAll('\\', '/'));
      expect(closure).toContain(entry);
      const forbidden = closure.filter(file => /\/legacy\/|src\/(?:speed|lego|generators|automotive)\/|src\/inventory\/(?:index|mock|rebrickable|snapshot)\.ts$/.test(file));
      expect(forbidden).toEqual([]);
      expect(closure).toContain('src/parts/ldraw/bundled.ts');
    });

  it('C: historical collision exceptions cannot turn real overlapping native solids into clearance', async () => {
    const original = (await new NativePartRepository().getPart('3005'))!;
    const part = Object.assign(structuredClone(original), {
      legacyStatus: 'LEGACY_QUARANTINED',
      collisionExceptions: [{ allowAll: true, penetrationDepth: 9999 }],
      collisionProxy: { empty: true },
    });
    const a = { instanceId: 'a', partId: '3005', transform: structuredClone(IDENTITY_TRANSFORM) };
    const b = { ...a, instanceId: 'b' };
    const result = checkNativePairCollision(part, a, part, b);
    expect(result.status).toBe('collision');
    expect(result.proof.wholePairExempted).toBe(false);
    expect(result.classification).toBe('SOLID_SOLID_OVERLAP');
  });

  it('F: preserves source model placements for research while marking catalog-derived analysis unverified', () => {
    const model = importReferenceModel({
      text: '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      metadata: { source: 'original-governance-test', modelName: 'Original test fixture', author: 'Test', license: 'user-owned', attribution: 'Original fixture', rightsDeclaration: { ownsRights: true, statement: 'Original minimal test model.' } },
    });
    const before = structuredClone(model.submodels);
    const analysis = analyzeReferenceModel(model);
    expect(model.submodels).toEqual(before);
    expect(model.parts[0].fileName).toBe('3001.dat');
    expect(analysis.sourceGovernance).toMatchObject({ status: 'LEGACY_UNVERIFIED', nativeAdmissionAllowed: false, revalidationRequired: true });
    expect(analysis.connections.evidence.join(' ')).not.toContain('verified native-origin connectors');
  });
});
