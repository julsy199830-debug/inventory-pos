-- Phase 5: employee time & attendance (DTR).
--
-- Two new tables, nothing existing rebuilt, dropped or rewritten. The only
-- changes to existing models are back-relations (`Shift.breaks`,
-- `Shift.corrections`, `User.dtrCorrections`) which are virtual Prisma fields
-- (no column) and produce no DDL at all. Non-destructive by construction.
--
-- `ShiftBreak` is the unpaid pause inside a `Shift` window (break start →
-- break end); several can exist per shift and an open one has `end IS NULL`.
-- `DtrCorrection` stores the before/after evidence when a manager repairs a
-- missed or wrong punch: the `Shift` row itself is updated in place (it stays
-- the source of truth for time-worked and the clock-out sale snapshots), and
-- the same change is also written to `AuditLog`. Correcting manager is
-- snapshotted as `correctedByName` (not an FK) so the row survives admin
-- cleanup, mirroring `AuditLog.actor`.
--
-- Both tables cascade off `Shift`, matching `Shift.user`'s existing
-- `ON DELETE CASCADE` so deleting a user still removes their whole attendance
-- trail in one go (no orphan rows).

-- CreateTable
CREATE TABLE "ShiftBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT NOT NULL,
    "start" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShiftBreak_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DtrCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" DATETIME,
    "after" DATETIME,
    "reason" TEXT NOT NULL,
    "correctedById" TEXT,
    "correctedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DtrCorrection_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DtrCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShiftBreak_shiftId_idx" ON "ShiftBreak"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftBreak_start_idx" ON "ShiftBreak"("start");

-- CreateIndex
CREATE INDEX "DtrCorrection_shiftId_idx" ON "DtrCorrection"("shiftId");

-- CreateIndex
CREATE INDEX "DtrCorrection_userId_idx" ON "DtrCorrection"("userId");

-- CreateIndex
CREATE INDEX "DtrCorrection_createdAt_idx" ON "DtrCorrection"("createdAt");
