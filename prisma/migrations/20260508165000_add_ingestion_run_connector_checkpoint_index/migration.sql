CREATE INDEX IF NOT EXISTS "IngestionRun_connectorKey_startedAt_idx"
ON "IngestionRun"("connectorKey", "startedAt" DESC);
