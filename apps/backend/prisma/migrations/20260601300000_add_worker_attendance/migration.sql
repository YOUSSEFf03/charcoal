-- Migration: 20260601300000_add_worker_attendance
-- Adds dailyRate to workers and a worker_attendance table for persisted
-- daily attendance records.

ALTER TABLE "workers" ADD COLUMN "dailyRate" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE "worker_attendance" (
    "id"        TEXT        NOT NULL,
    "workerId"  TEXT        NOT NULL,
    "date"      DATE        NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "worker_attendance_pkey"            PRIMARY KEY ("id"),
    CONSTRAINT "worker_attendance_workerId_fkey"   FOREIGN KEY ("workerId")
        REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "worker_attendance_workerId_date_key" UNIQUE ("workerId", "date")
);

CREATE INDEX "worker_attendance_workerId_idx" ON "worker_attendance"("workerId");
CREATE INDEX "worker_attendance_date_idx"     ON "worker_attendance"("date");
