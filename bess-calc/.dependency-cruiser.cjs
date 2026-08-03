/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Circular imports make impact analysis unreliable and often indicate a module boundary was crossed accidentally.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'engine-no-express',
      comment:
        'src/engine, src/battery, src/tariff, src/optimisation, and src/import are documented (CALCULATION_ENGINE_DESIGN.md, CURRENT_CODE_ARCHITECTURE.md) as framework-independent so they can run identically client-side and server-side. They must not depend on express or the Prisma client.',
      severity: 'error',
      from: { path: '^src/(engine|battery|tariff|optimisation|import)' },
      to: { path: '^(server|node_modules/(express|@prisma/client))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '__tests__|\\.test\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
