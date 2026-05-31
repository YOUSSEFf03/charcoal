-- AlterTable
ALTER TABLE "packing_sessions" ADD COLUMN     "workerEntityId" TEXT;

-- AddForeignKey
ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_workerEntityId_fkey" FOREIGN KEY ("workerEntityId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
