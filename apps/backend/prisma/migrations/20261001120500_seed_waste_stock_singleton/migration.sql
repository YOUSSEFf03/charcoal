-- Seed the one-and-only waste_stock row. WasteStock's doc comment in schema.prisma
-- declares "always exactly one row, id = 'singleton'" — seeded here, at migration
-- time, rather than lazily upserted on first use, so that invariant holds from the
-- moment this migration runs, in every environment, with no app-code race to get it
-- wrong on a fresh/concurrent first request.
INSERT INTO "waste_stock" ("id", "kgOnHand", "updatedAt") VALUES ('singleton', 0, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
