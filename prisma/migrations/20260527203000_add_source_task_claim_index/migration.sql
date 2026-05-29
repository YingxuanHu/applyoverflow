CREATE INDEX "SourceTask_kind_status_notBeforeAt_priorityScore_createdAt_idx"
ON "SourceTask"("kind", "status", "notBeforeAt", "priorityScore" DESC, "createdAt");
