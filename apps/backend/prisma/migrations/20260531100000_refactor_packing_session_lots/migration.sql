-- CreateTable: proper many-to-many junction between packing_sessions and stock_lots
CREATE TABLE "packing_session_lots" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kgUsed" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "packing_session_lots_pkey" PRIMARY KEY ("id")
);

-- DataMigration: sessions that already had multi-lot data in lotInputs JSON
INSERT INTO "packing_session_lots" ("id", "sessionId", "lotId", "kgUsed")
SELECT
    gen_random_uuid()::text,
    ps.id,
    elem->>'lotId',
    (elem->>'kg')::DECIMAL(10,3)
FROM "packing_sessions" ps,
    jsonb_array_elements(ps."lotInputs") AS elem
WHERE jsonb_array_length(ps."lotInputs") > 0;

-- DataMigration: sessions with empty lotInputs — use primary lotId + kgConsumed
INSERT INTO "packing_session_lots" ("id", "sessionId", "lotId", "kgUsed")
SELECT
    gen_random_uuid()::text,
    ps.id,
    ps."lotId",
    ps."kgConsumed"
FROM "packing_sessions" ps
WHERE jsonb_array_length(ps."lotInputs") = 0;

-- AddForeignKey
ALTER TABLE "packing_session_lots" ADD CONSTRAINT "packing_session_lots_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "packing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "packing_session_lots" ADD CONSTRAINT "packing_session_lots_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "packing_session_lots_sessionId_idx" ON "packing_session_lots"("sessionId");
CREATE INDEX "packing_session_lots_lotId_idx" ON "packing_session_lots"("lotId");

-- DropForeignKey: remove old direct FK from packing_sessions to stock_lots
ALTER TABLE "packing_sessions" DROP CONSTRAINT "packing_sessions_lotId_fkey";

-- DropColumn: lotId and lotInputs are now fully replaced by packing_session_lots
ALTER TABLE "packing_sessions" DROP COLUMN "lotId";
ALTER TABLE "packing_sessions" DROP COLUMN "lotInputs";
