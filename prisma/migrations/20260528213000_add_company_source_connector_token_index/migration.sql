CREATE INDEX IF NOT EXISTS "CompanySource_connectorName_token_idx"
ON "CompanySource"("connectorName", "token");
