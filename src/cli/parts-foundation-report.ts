import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RealPartRegistry } from '../parts/registry.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== '--output' || args.length !== 2 || !args[1])) throw new Error('Usage: npm run report:parts -- [--output directory]');
  const directory = path.resolve(args[1] ?? 'artifacts/parts-foundation');
  const registry = new RealPartRegistry();
  const status = await registry.status(), parts = await registry.list();
  const geometryCategories = Object.fromEntries([...new Set(parts.filter(part => part.identitySystem === 'ldraw').map(part => part.category ?? 'Other'))].sort().map(category => [category, parts.filter(part => part.identitySystem === 'ldraw' && (part.category ?? 'Other') === category).length]));
  const report = { ...status, geometryCategories, reportNotes: ['Counts are software readiness observations, not human or physical build certification.', 'Geometry bootstrap categories are unrelated to Speed frequency until documentary identity mapping is available.'] };
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const header = 'rank,identitySystem,elementId,distinctSets,observedQuantity,knownNonSpareQuantity,spareUnknownQuantity,setNumbers,sourceIds';
  const rows = status.elementRanking.map(row => [row.rank, row.identity.system, row.identity.id, row.distinctSetCount, row.observedQuantity, row.knownNonSpareQuantity, row.spareUnknownQuantity, row.setNumbers.join(' + '), row.sourceIds.join(' + ')].join(','));
  await writeFile(path.join(directory, 'element-frequency.csv'), [header, ...rows].join('\r\n') + '\r\n');
  await writeFile(path.join(directory, 'next-50-element-mapping-targets.csv'), [header, ...rows.slice(0, 50)].join('\r\n') + '\r\n');
  await writeFile(path.join(directory, 'next-design-parts.json'), JSON.stringify(status.nextPriority, null, 2) + '\n');
  console.info(JSON.stringify({ directory, counts: status.counts, actualInventorySets: status.mining.actualSetDenominator, elementIdentities: status.elementRanking.length, rankedDesignParts: status.nextPriority.length, geometryCategories }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Unable to create source report.'); process.exitCode = 1; });
