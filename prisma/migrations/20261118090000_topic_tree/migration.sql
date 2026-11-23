-- CreateEnum
CREATE TYPE "TopicLevel" AS ENUM ('category', 'event', 'type');

-- DropIndex
DROP INDEX "topics_name_key";

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "level" "TopicLevel" NOT NULL DEFAULT 'type',
ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "template_places" (
    "template_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    CONSTRAINT "template_places_pkey" PRIMARY KEY ("template_id","topic_id")
);

-- CreateTable
CREATE TABLE "asset_places" (
    "asset_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,

    CONSTRAINT "asset_places_pkey" PRIMARY KEY ("asset_id","topic_id")
);

-- CreateIndex
CREATE INDEX "template_places_topic_id_idx" ON "template_places"("topic_id");

-- CreateIndex
CREATE INDEX "asset_places_topic_id_idx" ON "asset_places"("topic_id");

-- CreateIndex
CREATE INDEX "topics_parent_id_idx" ON "topics"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_parent_id_name_key" ON "topics"("parent_id", "name");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_places" ADD CONSTRAINT "template_places_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_places" ADD CONSTRAINT "template_places_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_places" ADD CONSTRAINT "asset_places_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_places" ADD CONSTRAINT "asset_places_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every template keeps the place it had
INSERT INTO "template_places" ("template_id", "topic_id")
SELECT "id", "topic_id" FROM "templates" WHERE "topic_id" IS NOT NULL;
