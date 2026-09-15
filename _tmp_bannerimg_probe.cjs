// Read-only: where do the 404-ing UUID filenames live?
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const targets = [
  "a6503c59-9748-4c54-a896-72490bf06bcb",
  "30226c64-b490-4b54-b730-fb4972b2b71a",
];

(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.DB_NAME || "shopnest" });
  const db = mongoose.connection.db;

  const names = (await db.listCollections().toArray()).map((c) => c.name);
  console.log("collections:", names.join(", "));

  const cats = await db.collection("categories").find({}).toArray();
  const localCats = cats.filter((c) => String(c.image || "").startsWith("/uploads/"));
  const remoteCats = cats.filter((c) => /^https?:/.test(String(c.image || "")));
  console.log(`\ncategories: ${cats.length} | local /uploads: ${localCats.length} | remote: ${remoteCats.length}`);
  console.log("sample local category images:", localCats.slice(0, 8).map((c) => `${c.name} -> ${c.image}`));

  for (const t of targets) {
    const cat = cats.find((c) => String(c.image || "").includes(t));
    console.log(`\ntarget ${t}: category = ${cat ? cat.name : "NOT FOUND in categories"}`);
  }

  // Also scan a couple of other likely collections for the UUIDs.
  for (const coll of ["herobanners", "reviews", "products"]) {
    if (!names.includes(coll)) continue;
    const docs = await db.collection(coll).find({}).toArray();
    const hit = docs.filter((d) => JSON.stringify(d).includes(targets[0]) || JSON.stringify(d).includes(targets[1]));
    console.log(`${coll}: matches = ${hit.length}`);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error("probe error:", e.message);
  process.exit(1);
});
