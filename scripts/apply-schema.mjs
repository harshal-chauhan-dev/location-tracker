import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "..", "drizzle", "0000_init.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log("Schema applied: users table created.");
} catch (e) {
  if (e.code === "42P07") {
    console.log("Table users already exists; nothing to do.");
  } else {
    throw e;
  }
}
await client.end();
