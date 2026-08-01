-- DropForeignKey
ALTER TABLE "interval_datasets" DROP CONSTRAINT "interval_datasets_projectId_fkey";

-- DropForeignKey
ALTER TABLE "interval_records" DROP CONSTRAINT "interval_records_datasetId_fkey";

-- DropForeignKey
ALTER TABLE "scenarios" DROP CONSTRAINT "scenarios_projectId_fkey";

-- DropForeignKey
ALTER TABLE "simulation_results" DROP CONSTRAINT "simulation_results_simulationRunId_fkey";

-- DropForeignKey
ALTER TABLE "simulation_runs" DROP CONSTRAINT "simulation_runs_scenarioId_fkey";

-- CreateIndex
CREATE INDEX "simulation_runs_status_idx" ON "simulation_runs"("status");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interval_datasets" ADD CONSTRAINT "interval_datasets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interval_records" ADD CONSTRAINT "interval_records_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "interval_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_simulationRunId_fkey" FOREIGN KEY ("simulationRunId") REFERENCES "simulation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

