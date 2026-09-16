-- Fibre routes on the network map (NCA, 15 September 2026).
--
-- "Network Map: Display the complete fiber route."
--
-- The map plots points. A route is the line between two of them, and there were two places that
-- line could have come from: the site register, or the KML and OFDS files operators already attach
-- to their returns. NCA chose the register. The map is the live picture of the network, and a
-- route read out of a filed attachment would show it as it was for one reporting period instead.
--
-- `path` is why this can be called complete. Fibre follows roads, so the straight line between two
-- nodes is a guess at the route rather than the route. An operator holding the geometry supplies
-- it; one that has not yet gets the straight line, drawn as an indication and labelled as one.
-- Stored as JSON rather than PostGIS geometry: the portal draws routes and measures nothing, and a
-- spatial extension is a dependency on the Authority's database server for no question it answers.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'FIBRE_LINK_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'FIBRE_LINK_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'FIBRE_LINK_DELETED';

-- CreateTable
CREATE TABLE "fibre_links" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "link_reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "network_site_status" NOT NULL DEFAULT 'ACTIVE',
    "from_site_id" UUID NOT NULL,
    "to_site_id" UUID NOT NULL,
    "length_km" DECIMAL(10,3),
    "capacity_gbps" INTEGER,
    "path" JSONB,
    "commissioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibre_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fibre_links_entity_id_idx" ON "fibre_links"("entity_id");

-- CreateIndex
CREATE INDEX "fibre_links_status_idx" ON "fibre_links"("status");

-- CreateIndex
CREATE INDEX "fibre_links_deleted_at_idx" ON "fibre_links"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "fibre_links_entity_id_link_reference_key" ON "fibre_links"("entity_id", "link_reference");

-- AddForeignKey
ALTER TABLE "fibre_links" ADD CONSTRAINT "fibre_links_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fibre_links" ADD CONSTRAINT "fibre_links_from_site_id_fkey" FOREIGN KEY ("from_site_id") REFERENCES "network_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fibre_links" ADD CONSTRAINT "fibre_links_to_site_id_fkey" FOREIGN KEY ("to_site_id") REFERENCES "network_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
