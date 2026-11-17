-- CreateTable
CREATE TABLE "text_styles" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "name" TEXT NOT NULL,
    "look" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_styles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "text_styles_workspace_id_idx" ON "text_styles"("workspace_id");

-- AddForeignKey
ALTER TABLE "text_styles" ADD CONSTRAINT "text_styles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
