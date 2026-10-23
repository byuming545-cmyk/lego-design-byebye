import { expect, type Locator } from '@playwright/test';
import type { InterfaceCoverageMetrics } from '../../src/components/InterfaceCoverage.js';

interface Graph {
  placements: { instanceId: string }[];
  edges: { id: string; fixedInstanceId: string; fixedConnectionId: string; movingInstanceId: string; movingConnectionId: string }[];
}

/** Multiple physical connections can join the same two parts; connected does not mean a tree. */
export function expectConnectedAssembly(graph: Graph) {
  const nodes = new Set(graph.placements.map((placement) => placement.instanceId));
  expect(nodes.size).toBe(graph.placements.length);
  expect(nodes.size).toBeGreaterThan(0);
  expect(graph.edges.length).toBeGreaterThanOrEqual(nodes.size - 1);
  const adjacent = new Map([...nodes].map((id) => [id, new Set<string>()]));
  const edgeIds = new Set<string>(), occupied = new Set<string>();
  for (const edge of graph.edges) {
    expect(edgeIds.has(edge.id)).toBe(false); edgeIds.add(edge.id);
    expect(nodes.has(edge.fixedInstanceId)).toBe(true);
    expect(nodes.has(edge.movingInstanceId)).toBe(true);
    expect(edge.fixedInstanceId).not.toBe(edge.movingInstanceId);
    for (const [instance, connection] of [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]]) {
      expect(connection.length).toBeGreaterThan(0);
      const key = JSON.stringify([instance, connection]);
      expect(occupied.has(key), 'A source endpoint cannot be occupied twice.').toBe(false);
      occupied.add(key);
    }
    adjacent.get(edge.fixedInstanceId)!.add(edge.movingInstanceId);
    adjacent.get(edge.movingInstanceId)!.add(edge.fixedInstanceId);
  }
  const reached = new Set<string>(), pending = [graph.placements[0].instanceId];
  while (pending.length) { const id = pending.pop()!; if (reached.has(id)) continue; reached.add(id); pending.push(...adjacent.get(id)!); }
  expect(reached.size).toBe(nodes.size);
}

export async function expectCoverageMatches(region: Locator, coverage: InterfaceCoverageMetrics) {
  for (const [label, key] of [['已发现物理接口', 'physicalInterfacesDiscovered'], ['PASS', 'verifiedPass'], ['BLOCKED', 'verifiedBlocked'], ['REQUIRES_ASTRA_REVIEW', 'requiresAstraReview'], ['PENDING', 'pending']] as const) {
    await expect(region.locator('.interface-coverage-states > div').filter({ has: region.page().getByText(label, { exact: true }) }).locator('strong')).toHaveText(String(coverage[key]));
  }
  for (const [label, key] of [['原始来源连接记录', 'rawSourceConnectionRecords'], ['逻辑连接组', 'logicalConnectionGroups'], ['已验证物理接口', 'verifiedPhysicalInterfaces'], ['已开放原始连接 ID', 'enabledRawConnectionIds'], ['已开放物理接口', 'enabledPhysicalInterfaces']] as const) {
    await expect(region.locator('.interface-coverage-units > div').filter({ has: region.page().getByText(label, { exact: true }) }).locator('dd')).toHaveText(String(coverage[key]));
  }
  expect(coverage.verifiedPass + coverage.verifiedBlocked + coverage.requiresAstraReview + coverage.pending).toBe(coverage.physicalInterfacesDiscovered);
  expect(coverage.enabledPhysicalInterfaces).toBeLessThanOrEqual(coverage.verifiedPass);
  expect(coverage.enabledRawConnectionIds).toBeLessThanOrEqual(coverage.rawSourceConnectionRecords);
  const display = (value: number | null) => value == null ? '—' : `${Number(value.toFixed(2))}%`;
  await expect(region.locator('.interface-coverage-percentages > div').filter({ hasText: '已验证覆盖率' }).locator('dd')).toHaveText(display(coverage.verifiedCoveragePercent));
  await expect(region.locator('.interface-coverage-percentages > div').filter({ hasText: '已处理覆盖率' }).locator('dd')).toHaveText(display(coverage.processedCoveragePercent));
  if (coverage.physicalInterfacesDiscovered) {
    expect(coverage.verifiedCoveragePercent).toBeCloseTo(100 * coverage.verifiedPass / coverage.physicalInterfacesDiscovered, 2);
    expect(coverage.processedCoveragePercent).toBeCloseTo(100 * (coverage.verifiedPass + coverage.verifiedBlocked + coverage.requiresAstraReview) / coverage.physicalInterfacesDiscovered, 2);
  } else {
    expect(coverage.verifiedCoveragePercent).toBeNull();
    expect(coverage.processedCoveragePercent).toBeNull();
  }
}
