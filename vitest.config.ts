import { defineConfig } from "vitest/config";
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export default defineConfig({
  test: { include: ["tests/*.test.ts"], env: { BRICKLAB_DATA_DIR: path.join(tmpdir(), `bricklab-tests-${randomUUID()}`) } },
});
