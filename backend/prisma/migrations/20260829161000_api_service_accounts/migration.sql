-- AlterTable
ALTER TABLE "api_clients" ADD COLUMN     "service_user_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_service_account" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_service_user_id_key" ON "api_clients"("service_user_id");

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_service_user_id_fkey" FOREIGN KEY ("service_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

