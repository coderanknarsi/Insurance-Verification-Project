import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { DEMO_USER_UID, DEMO_ORG_ID } from "../constants";
import { collections } from "../config/firestore";
import { seedDemoData } from "../services/demo-seed";
import { logger } from "firebase-functions/v2";
import { UserRole } from "../types/user";

// Simple in-memory rate limiter
const recentRequests: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 10;

export const getDemoToken = onCall(async () => {
  // Rate limit
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  // Remove old entries
  while (recentRequests.length > 0 && recentRequests[0] < oneMinuteAgo) {
    recentRequests.shift();
  }
  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new HttpsError("resource-exhausted", "Too many demo requests. Please try again in a minute.");
  }
  recentRequests.push(now);

  // Ensure demo user exists in Firebase Auth
  try {
    await admin.auth().getUser(DEMO_USER_UID);
  } catch {
    await admin.auth().createUser({
      uid: DEMO_USER_UID,
      email: "demo@autolientracker.com",
      displayName: "Demo User",
    });
    logger.info("Created demo Firebase Auth user");
  }

  // Ensure demo user doc exists in Firestore
  const userDoc = await collections.users.doc(DEMO_USER_UID).get();
  if (!userDoc.exists) {
    await collections.users.doc(DEMO_USER_UID).set({
      organizationId: DEMO_ORG_ID,
      email: "demo@autolientracker.com",
      displayName: "Demo User",
      role: UserRole.ADMIN,
      firebaseAuthUid: DEMO_USER_UID,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  // Ensure demo org exists with seed data
  const orgDoc = await collections.organizations.doc(DEMO_ORG_ID).get();
  if (!orgDoc.exists) {
    await seedDemoData();
    logger.info("Seeded demo org on first demo token request");
  }

  // Generate custom auth token
  const token = await admin.auth().createCustomToken(DEMO_USER_UID);

  logger.info("Demo token generated");
  return { token };
});
