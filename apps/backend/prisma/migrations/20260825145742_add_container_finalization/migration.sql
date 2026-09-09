-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedById" TEXT;

-- CreateIndex
CREATE INDEX "containers_finalizedAt_idx" ON "containers"("finalizedAt");

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
