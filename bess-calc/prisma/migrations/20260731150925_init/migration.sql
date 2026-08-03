-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerName" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalDatasetId" TEXT,
    "batteryConfig" JSONB NOT NULL,
    "tariffConfig" JSONB NOT NULL,
    "solarConfig" JSONB NOT NULL,
    "generatorConfig" JSONB NOT NULL,
    "financialConfig" JSONB NOT NULL,
    "dispatchPriorities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interval_datasets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceFile" TEXT,
    "timezone" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interval_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interval_records" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "loadKw" DOUBLE PRECISION NOT NULL,
    "loadKva" DOUBLE PRECISION,
    "solarKw" DOUBLE PRECISION,
    "dgKw" DOUBLE PRECISION,
    "powerFactor" DOUBLE PRECISION,

    CONSTRAINT "interval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_runs" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_results" (
    "id" TEXT NOT NULL,
    "simulationRunId" TEXT NOT NULL,
    "peakReductionKw" DOUBLE PRECISION NOT NULL,
    "energySavings" DOUBLE PRECISION NOT NULL,
    "demandSavings" DOUBLE PRECISION NOT NULL,
    "arbitrageSavings" DOUBLE PRECISION NOT NULL,
    "totalSavings" DOUBLE PRECISION NOT NULL,
    "irr" DOUBLE PRECISION,
    "npv" DOUBLE PRECISION NOT NULL,
    "savingsBreakdown" JSONB NOT NULL,
    "technicalResult" JSONB NOT NULL,
    "financialResult" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenarios_projectId_idx" ON "scenarios"("projectId");

-- CreateIndex
CREATE INDEX "interval_datasets_projectId_idx" ON "interval_datasets"("projectId");

-- CreateIndex
CREATE INDEX "interval_records_datasetId_timestamp_idx" ON "interval_records"("datasetId", "timestamp");

-- CreateIndex
CREATE INDEX "simulation_runs_scenarioId_idx" ON "simulation_runs"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_results_simulationRunId_key" ON "simulation_results"("simulationRunId");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_intervalDatasetId_fkey" FOREIGN KEY ("intervalDatasetId") REFERENCES "interval_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interval_datasets" ADD CONSTRAINT "interval_datasets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interval_records" ADD CONSTRAINT "interval_records_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "interval_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "simulation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

