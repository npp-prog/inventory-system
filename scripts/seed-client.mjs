// Alternate seed script using the Firebase CLIENT SDK - no admin service-account key needed.
//
// Use this instead of scripts/seed.mjs if your Firebase project sits under a Google Workspace
// org that blocks service-account key creation ("Key creation is not allowed on this service
// account... restricted by organization policies"). This was exactly the case for MGO-Candoni's
// Firebase project on the sibling Property Management System - see that project's build notes.
//
// It signs in as one of the app's own Firebase Auth users and writes through the same
// firestore.rules ("any signed-in user") the app itself uses, so it needs nothing extra set up.
//
// Usage:
//   npm install
//   node scripts/seed-client.mjs you@yourdomain.com "your-password"

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, doc, writeBatch } from "firebase/firestore";
import { firebaseConfig } from "../js/firebase-config.js";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: node scripts/seed-client.mjs you@yourdomain.com \"your-password\"");
    process.exit(1);
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);

  const itemsPath = new URL("../data/seed_items.json", import.meta.url);
  if (!existsSync(itemsPath)) {
    console.log("No data/seed_items.json found - nothing to seed yet. See data/README.md.");
    return;
  }
  const items = JSON.parse(await readFile(itemsPath, "utf8"));
  const batchSize = 400;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = writeBatch(db);
    for (const item of items.slice(i, i + batchSize)) {
      const { id, ...rest } = item;
      batch.set(id ? doc(db, "items", id) : doc(collection(db, "items")), rest);
    }
    await batch.commit();
    console.log(`Seeded ${Math.min(i + batchSize, items.length)} / ${items.length} items`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
