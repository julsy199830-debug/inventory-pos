/**
 * Phase 5 DTR tests: breaks, the clock-out guard, and manager corrections.
 *
 * Uses a disposable migrated SQLite database and the same Next.js
 * request-surface mocks as the employee authorization tests. No browser or
 * real dev.db is involved.
 *
 * The four behaviors under test are the ones the DTR feature stands on:
 *   1. an open break blocks clock-out (time-worked can't swallow break time),
 *   2. a second break can't be stacked on an open one,
 *   3. correction requires an ADMIN/MANAGER actor and a non-trivial reason,
 *   4. a successful correction writes before/after evidence AND the audit row.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { signSessionValue } from "@/lib/session-token";

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
/**
 * The signature of Node's internal `Module._resolveFilename`, which this
 * harness monkey-patches to redirect Next.js server-only imports at the mocks
 * above. Typed explicitly rather than as `Function` so the `.apply(this, args)`
 * forwarding below type-checks.
 */
type ResolveFilenameArgs = [
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
];
type ResolveFilename = (...args: ResolveFilenameArgs) => string;
const moduleResolver = Module as unknown as {
  _resolveFilename: ResolveFilename;
};
const originalResolve = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (
  this: unknown,
  ...args: ResolveFilenameArgs
) {
  return MOCKS[args[0]] ?? originalResolve.apply(this, args);
};

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

const DB_DIR = path.resolve("test-results", "dtr-actions-db");
const DB_REL_URL = "file:./test-results/dtr-actions-db/test.db";
const IDS = {
  admin: "dtr-admin",
  manager: "dtr-manager",
  cashier: "dtr-cashier",
  /** A SECOND cashier — the victim of a forged cross-employee punch. */
  other: "dtr-other",
} as const;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asUser(userId: string | null): void {
  // Signed session: the cookie is `<id>.<hmac>` (src/lib/session-token.ts).
  globalThis.__PO_TEST_COOKIES__ =
    userId === null ? {} : { "pos-cashier": signSessionValue(userId) };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function main(): Promise<void> {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  process.env.DATABASE_URL = DB_REL_URL;
  const migration = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATABASE_URL: DB_REL_URL },
  });
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const { prisma } = await import("@/lib/db");
  const actions = await import("@/app/(dashboard)/employees/actions");
  const dtr = await import("@/app/(dashboard)/dtr/actions");

  try {
    for (const [id, name, role] of [
      [IDS.admin, "DTR Admin", "ADMIN"],
      [IDS.manager, "DTR Manager", "MANAGER"],
      [IDS.cashier, "DTR Cashier", "CASHIER"],
      [IDS.other, "DTR Other Cashier", "CASHIER"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name,
          role,
          email: `${id}@dtr.test`,
          pinHash: "test-only",
          passwordHash: "test-only",
          active: true,
        },
      });
    }

    // ── 1. Open break blocks clock-out ───────────────────────────────────────
    await check("clock-out is rejected while a break is open", async () => {
      asUser(IDS.cashier);
      const clockedIn = await actions.clockIn(form({ userId: IDS.cashier }));
      assert.equal(clockedIn.ok, true);

      const breakStart = await actions.startBreak(form({ userId: IDS.cashier }));
      assert.equal(breakStart.ok, true);

      const blocked = await actions.clockOut(form({ userId: IDS.cashier }));
      assert.equal(blocked.ok, false);
      assert.match(blocked.error ?? "", /break/i);

      // The shift must still be open — the rejection changed nothing.
      const open = await prisma.shift.findFirst({
        where: { userId: IDS.cashier, end: null },
      });
      assert.ok(open, "shift stays open after a blocked clock-out");
    });

    // ── 2. A second break can't stack on an open one ────────────────────────
    await check("starting a break while already on break is rejected", async () => {
      asUser(IDS.cashier);
      const second = await actions.startBreak(form({ userId: IDS.cashier }));
      assert.equal(second.ok, false);
      assert.match(second.error ?? "", /already on break/i);

      const openBreaks = await prisma.shiftBreak.count({
        where: { end: null, shift: { userId: IDS.cashier } },
      });
      assert.equal(openBreaks, 1, "exactly one open break row exists");
    });

    await check("ending the break unlocks clock-out", async () => {
      asUser(IDS.cashier);
      const ended = await actions.endBreak(form({ userId: IDS.cashier }));
      assert.equal(ended.ok, true);

      const closed = await actions.clockOut(form({ userId: IDS.cashier }));
      assert.equal(closed.ok, true);

      const shift = await prisma.shift.findFirst({
        where: { userId: IDS.cashier },
        orderBy: { start: "desc" },
      });
      assert.ok(shift?.end, "shift closed after break ended");
    });

    // ── 3. Correction gate: role + required reason ───────────────────────────
    const shift = await prisma.shift.findFirstOrThrow({
      where: { userId: IDS.cashier },
      orderBy: { start: "desc" },
    });
    const correctionForm = (over: Record<string, string> = {}) =>
      form({
        shiftId: shift.id,
        field: "start",
        value: "2026-10-01T08:00",
        reason: "Forgot to clock in",
        ...over,
      });

    await check("CASHIER cannot correct a punch (denied before any write)", async () => {
      asUser(IDS.cashier);
      const before = await prisma.dtrCorrection.count();
      const res = await dtr.correctShiftTime(correctionForm());
      assert.equal(res.ok, false);
      assert.equal(await prisma.dtrCorrection.count(), before);
      const unchanged = await prisma.shift.findUniqueOrThrow({
        where: { id: shift.id },
        select: { start: true },
      });
      assert.equal(unchanged.start.getTime(), shift.start.getTime());
    });

    await check("signed-out user cannot correct a punch", async () => {
      asUser(null);
      const res = await dtr.correctShiftTime(correctionForm());
      assert.equal(res.ok, false);
    });

    await check("a correction without a real reason is rejected", async () => {
      asUser(IDS.manager);
      for (const reason of ["", "  ", "x"]) {
        const res = await dtr.correctShiftTime(correctionForm({ reason }));
        assert.equal(res.ok, false, `reason "${reason}" must be rejected`);
        assert.match(res.error ?? "", /reason/i);
      }
      assert.equal(
        await prisma.dtrCorrection.count({ where: { shiftId: shift.id } }),
        0,
        "no correction rows from rejected attempts",
      );
    });

    await check("an unknown field name is rejected", async () => {
      asUser(IDS.manager);
      const res = await dtr.correctShiftTime(
        correctionForm({ field: "totalSales", reason: "sneaky rewrite" }),
      );
      assert.equal(res.ok, false);
      assert.equal(
        await prisma.dtrCorrection.count({ where: { shiftId: shift.id } }),
        0,
      );
    });

    // ── 4. Successful correction: shift + evidence + audit ───────────────────
    await check("MANAGER correction updates the shift and records evidence", async () => {
      asUser(IDS.manager);
      const originalStart = shift.start;
      const res = await dtr.correctShiftTime(
        correctionForm({ value: "2026-10-01T08:05" }),
      );
      assert.equal(res.ok, true);

      const updated = await prisma.shift.findUniqueOrThrow({
        where: { id: shift.id },
        select: { start: true },
      });
      assert.equal(updated.start.toISOString(), new Date("2026-10-01T08:05").toISOString());

      const row = await prisma.dtrCorrection.findFirstOrThrow({
        where: { shiftId: shift.id },
      });
      assert.equal(row.field, "start");
      assert.equal(row.before?.toISOString(), originalStart.toISOString());
      assert.equal(row.after?.toISOString(), new Date("2026-10-01T08:05").toISOString());
      assert.equal(row.reason, "Forgot to clock in");
      assert.equal(row.userId, IDS.cashier);
      assert.equal(row.correctedById, IDS.manager);
      assert.equal(row.correctedByName, "DTR Manager");

      const audit = await prisma.auditLog.findFirst({
        where: { action: "DTR_CORRECTION", entityId: shift.id },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(audit, "the same change also lands in the AuditLog");
      assert.equal(audit.module, "EMPLOYEES");
      assert.equal(audit.actor, "DTR Manager");
    });

    await check("correcting to the same value is a no-op with an error", async () => {
      asUser(IDS.admin);
      const res = await dtr.correctShiftTime(
        correctionForm({ value: "2026-10-01T08:05" }),
      );
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /already/i);
      assert.equal(
        await prisma.dtrCorrection.count({ where: { shiftId: shift.id } }),
        1,
        "no extra row for a no-op attempt",
      );
    });

    await check("breaks + corrections cascade when the shift is deleted", async () => {
      const orphan = await prisma.shift.create({ data: { userId: IDS.cashier } });
      await prisma.shiftBreak.create({ data: { shiftId: orphan.id } });
      await prisma.dtrCorrection.create({
        data: {
          shiftId: orphan.id,
          userId: IDS.cashier,
          field: "end",
          before: null,
          after: new Date(),
          reason: "cascade probe",
        },
      });
      await prisma.shift.delete({ where: { id: orphan.id } });
      assert.equal(
        await prisma.shiftBreak.count({ where: { shiftId: orphan.id } }),
        0,
        "breaks cascade with the shift",
      );
      assert.equal(
        await prisma.dtrCorrection.count({ where: { shiftId: orphan.id } }),
        0,
        "corrections cascade with the shift",
      );
    });

    // ── 5. Cross-employee authorization on the four punches (security) ──────
    //
    // The regression this exists for: all four actions take `userId` from the
    // client, so before the fix ANY signed-in user could punch ANY employee.
    // The `(dashboard)` layout does not help — it only stops a CASHIER from
    // *rendering* /employees, and there is no middleware in front of a Server
    // Action call. These drive the actions directly, exactly as a forged POST
    // would.
    const punches = [
      ["clockIn", actions.clockIn],
      ["clockOut", actions.clockOut],
      ["startBreak", actions.startBreak],
      ["endBreak", actions.endBreak],
    ] as const;

    const stateOf = async (userId: string) => ({
      shifts: await prisma.shift.count({ where: { userId } }),
      openShifts: await prisma.shift.count({ where: { userId, end: null } }),
      breaks: await prisma.shiftBreak.count({
        where: { shift: { userId } },
      }),
    });

    for (const [label, action] of punches) {
      await check(
        `CASHIER is rejected punching ANOTHER employee (${label})`,
        async () => {
          const before = await stateOf(IDS.other);
          asUser(IDS.cashier);
          const res = await action(form({ userId: IDS.other }));
          assert.equal(res.ok, false, "must not succeed");
          assert.match(res.error ?? "", /only record your own/i);
          assert.deepEqual(
            await stateOf(IDS.other),
            before,
            `${label} changed the victim's attendance`,
          );
        },
      );

      await check(`signed-out caller is rejected (${label})`, async () => {
        const before = await stateOf(IDS.other);
        asUser(null);
        const res = await action(form({ userId: IDS.other }));
        assert.equal(res.ok, false, "must not succeed");
        assert.match(res.error ?? "", /signed in/i);
        assert.deepEqual(await stateOf(IDS.other), before);
      });
    }

    await check("CASHIER may punch THEMSELVES", async () => {
      asUser(IDS.cashier);
      const in_ = await actions.clockIn(form({ userId: IDS.cashier }));
      assert.equal(in_.ok, true);
      const broke = await actions.startBreak(form({ userId: IDS.cashier }));
      assert.equal(broke.ok, true);
      const unbreak = await actions.endBreak(form({ userId: IDS.cashier }));
      assert.equal(unbreak.ok, true);
      const out = await actions.clockOut(form({ userId: IDS.cashier }));
      assert.equal(out.ok, true);
    });

    for (const [actorId, actorName] of [
      [IDS.manager, "MANAGER"],
      [IDS.admin, "ADMIN"],
    ] as const) {
      await check(`${actorName} may punch another employee`, async () => {
        asUser(actorId);
        const inRes = await actions.clockIn(form({ userId: IDS.other }));
        assert.equal(inRes.ok, true, `${actorName} clock-in should be allowed`);
        const breakRes = await actions.startBreak(form({ userId: IDS.other }));
        assert.equal(breakRes.ok, true, `${actorName} break should be allowed`);
        const endRes = await actions.endBreak(form({ userId: IDS.other }));
        assert.equal(endRes.ok, true);
        const outRes = await actions.clockOut(form({ userId: IDS.other }));
        assert.equal(outRes.ok, true, `${actorName} clock-out should be allowed`);
      });
    }

    await check("the audit row names the REAL caller, not the form's userId", async () => {
      // A MANAGER punching a CASHIER: `entityId` is the subject, `actor` must
      // be the manager. Getting this backwards would make the trail unfalsifiable.
      asUser(IDS.manager);
      await actions.clockIn(form({ userId: IDS.other }));
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "EMPLOYEE_SHIFT_IN", entityId: IDS.other },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(audit.actor, "DTR Manager");
      assert.equal(audit.userId, IDS.manager);
    });

    console.log(`DTR action tests: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    rmSync(DB_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
