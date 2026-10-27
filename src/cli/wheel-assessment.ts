import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativePartRepository } from '../parts/assembly/source.js';
import { assessWheelAssemblySources } from '../parts/assembly/wheelAssessment.js';
import { AttachmentEngine } from '../parts/assembly/engine.js';

/** Diagnostic audit only; never creates a model or production qualification. */
export async function wheelAssessmentMain(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: tsx src/cli/wheel-assessment.ts [--output report.json]');
  const repository = new NativePartRepository();
  const report = { ...await assessWheelAssemblySources(id => repository.getPart(id)), generatedAt: new Date().toISOString(),
    versions: new AttachmentEngine({ mode: 'verification', loadPart: id => repository.getPart(id) }).versions };
  if (args.length) {
    const filename = path.resolve(args[1]); await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: report.status, sources: report.parts.map(part => ({ partId: part.partId, geometry: part.geometryStatus, connections: part.connectionStatus, proxy: part.collisionProxy.reasonCode })),
    reasonCodes: report.reasonCodes, mechanicalPairsCertified: 0, modelProduced: false }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  wheelAssessmentMain().catch(error => { console.error(error instanceof Error ? error.message : 'Wheel assessment failed.'); process.exitCode = 1; });
}
