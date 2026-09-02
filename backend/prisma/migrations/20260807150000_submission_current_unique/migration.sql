-- CreateIndex
CREATE UNIQUE INDEX "submissions_entity_id_period_id_version_key" ON "submissions"("entity_id", "period_id", "version");
