-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "label_id" TEXT;

-- CreateTable
CREATE TABLE "product_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "Audience" NOT NULL DEFAULT 'private',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_labels_audience_name_key" ON "product_labels"("audience", "name");

-- CreateIndex
CREATE INDEX "templates_label_id_idx" ON "templates"("label_id");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "product_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

