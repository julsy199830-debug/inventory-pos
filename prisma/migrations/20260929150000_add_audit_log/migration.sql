-- Phase 1e: the administrative audit trail.
--
-- One new table. Nothing existing is rebuilt, dropped or rewritten - the only
-- change to an existing model is the `User.auditLogs` back-relation, which is a
-- virtual Prisma field (no column) and so produces no DDL at all.
--
-- The four indexes mirror the four things the audit UI filters by: date range
-- (always applied, so it is the hot path), user, module and action.
--
-- `userId` is ON DELETE SET NULL rather than CASCADE, matching the existing
-- `Sale.cashierId` convention: removing an employee must not remove the
-- evidence of what they did. The denormalized `actor` name keeps such rows
-- readable after the user row is gone.

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
