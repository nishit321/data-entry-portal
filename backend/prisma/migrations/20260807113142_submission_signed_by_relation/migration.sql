-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
