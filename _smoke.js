const { PrismaClient } = require("./src/generated/prisma/client.js");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

(async () => {
  const p = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: "file:./dev.db" }),
  });
  const c = await p.user.count();
  console.log("prisma.user delegate works; user count =", c);
  await p.$disconnect();
})();
