// One-time seed script using firebase-admin + a service-account key.
//
// This repo ships with NO real inventory data yet (by design - see README.md, "Importing your
// real data"). This script is here so seeding is a drop-in step once you're ready: put your
// data as JSON files under data/ (see data/README.md for the exact shape) and run:
//   npm install
//   node scripts/seed.mjs
//
// If your Firebase project's org policy blocks creating a service-account key ("Key creation is
// not allowed on this service account..."), use scripts/seed-client.mjs instead - it signs in as
// a normal app user via the Firebase client SDK and needs no admin key.

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const KEY_PATH = new URL("../serviceAccountKey.json", import.meta.url);

async function main() {
  if (!existsSync(KEY_PATH)) {
    console.error("Missing serviceAccountKey.json in the repo root.");
    console.error("Firebase Console -> Project settings -> Service accounts -> Generate new private key.");
    console.error("Save the downloaded file as serviceAccountKey.json (already in .gitignore - never commit it).");
    process.exit(1);
  }
  const key = JSON.parse(await readFile(KEY_PATH, "utf8"));
  initializeApp({ credential: cert(key) });
  const db = getFirestore();

  const itemsPath = new URL("../data/seed_items.json", import.meta.url);
  if (!existsSync(itemsPath)) {
    console.log("No data/seed_items.json found - nothing to seed yet. See data/README.md.");
    return;
  }
  const items = JSON.parse(await readFile(itemsPath, "utf8"));
  const batchSize = 400;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = db.batch();
    for (const item of items.slice(i, i + batchSize)) {
      const { id, ...rest } = item;
      batch.set(db.collection("items").doc(id || db.collection("items").doc().id), rest);
    }
    await batch.commit();
    console.log(`Seeded ${Math.min(i + batchSize, items.length)} / ${items.length} items`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
