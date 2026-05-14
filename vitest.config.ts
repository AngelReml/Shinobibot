import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Incluimos solo los specs que están escritos en estilo vitest
    // (describe/it/expect). El repo tiene 18 archivos .test.ts pre-existentes
    // con patrón `main().catch(...)` (scripts E2E ad-hoc) que NO son specs
    // vitest — vitest los rechaza con "No test suite found". Se irán
    // portando uno a uno; este include conservador evita romper CI mientras.
    include: [
      'src/audit/__tests__/audit_log.test.ts',
      'src/channels/__tests__/**/*.test.ts',
      'src/committee/__tests__/committee_evolutive.test.ts',
      'src/context/__tests__/**/*.test.ts',
      'src/coordinator/__tests__/**/*.test.ts',
      'src/memory/__tests__/memory_citations.test.ts',
      'src/observability/__tests__/**/*.test.ts',
      'src/memory/embedding_providers/__tests__/**/*.test.ts',
      'src/persistence/__tests__/missions_recurrent.test.ts',
      'src/plugins/__tests__/**/*.test.ts',
      'src/providers/__tests__/**/*.test.ts',
      'src/reader/__tests__/deep_descent.test.ts',
      'src/runtime/__tests__/mission_scheduler.test.ts',
      'src/sandbox/__tests__/**/*.test.ts',
      'src/skills/__tests__/skill_signing.test.ts',
      'src/skills/__tests__/skill_auditor.test.ts',
      'src/skills/__tests__/anthropic_skill_installer.test.ts',
      'src/skills/__tests__/skill_registry.test.ts',
      'src/tools/__tests__/docker_backend.test.ts',
      'src/tools/__tests__/tool_pack_pure.test.ts',
      'src/tools/__tests__/voice_tools.test.ts',
      'src/tui/__tests__/**/*.test.tsx',
      'src/web/__tests__/pwa.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'scratch', 'test_*.ts'],
    pool: 'forks',
    isolate: true,
    globals: false,
    testTimeout: 10_000,
  },
});
