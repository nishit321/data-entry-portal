-- CreateIndex
CREATE INDEX "submissions_template_id_idx" ON "submissions"("template_id");

-- CreateIndex
CREATE INDEX "submissions_is_late_idx" ON "submissions"("is_late");

-- CreateIndex
CREATE INDEX "submissions_submitted_at_idx" ON "submissions"("submitted_at");
