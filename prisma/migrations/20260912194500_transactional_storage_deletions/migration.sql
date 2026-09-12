-- Cover explicit document removal and account cascades in the same transaction.
-- A rollback retains both the document and its file; workers only see committed intent.
CREATE FUNCTION enqueue_deleted_document_storage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "StorageDeletionTask" ("storageKey") VALUES (OLD."storageKey")
  ON CONFLICT ("storageKey") DO UPDATE SET "nextAttemptAt" = CURRENT_TIMESTAMP;
  RETURN OLD;
END;
$$;

CREATE TRIGGER document_storage_deletion
AFTER DELETE ON "Document"
FOR EACH ROW EXECUTE FUNCTION enqueue_deleted_document_storage();
