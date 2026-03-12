import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

// Connect to emulator
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";

admin.initializeApp({ projectId: "insurance-track-os" });
const db = admin.firestore();

async function seed() {
  console.log("Seeding Firestore emulator...");

  // 1. Create organization
  const orgRef = db.collection("organizations").doc("demo-org");
  await orgRef.set({
    name: "Demo BHPH Dealership",
    type: "BHPH_DEALER",
    address: {
      street: "123 Main St",
      city: "Dallas",
      state: "TX",
      zip: "75201",
    },
    settings: {
      notificationPreference: "LENDER_ONLY",
      lapseGracePeriodDays: 15,
      expirationWarningDays: 30,
    },
    subscription: {
      tier: "STARTER",
      perBorrowerRate: 3.0,
      activeMonitoredCount: 0,
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Organization: demo-org");

  // 2. Create user (also create in Firebase Auth emulator)
  const userRecord = await admin.auth().createUser({
    uid: "demo-user",
    email: "admin@demo-dealer.com",
    password: "password123",
    displayName: "Demo Admin",
  });

  const userRef = db.collection("users").doc(userRecord.uid);
  await userRef.set({
    organizationId: "demo-org",
    email: "admin@demo-dealer.com",
    displayName: "Demo Admin",
    role: "ADMIN",
    firebaseAuthUid: userRecord.uid,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ User: demo-user (admin@demo-dealer.com / password123)");

  // 3. Create borrower
  const borrowerRef = db.collection("borrowers").doc("demo-borrower");
  await borrowerRef.set({
    organizationId: "demo-org",
    firstName: "John",
    lastName: "Smith",
    email: "john.smith@example.com",
    phone: "+12145551234",
    loanNumber: "LN-2024-001",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Borrower: demo-borrower");

  // 4. Create vehicle
  const vehicleRef = db.collection("vehicles").doc("demo-vehicle");
  await vehicleRef.set({
    borrowerId: "demo-borrower",
    organizationId: "demo-org",
    vin: "1HGCM82633A004352",
    make: "Honda",
    model: "Accord",
    year: 2022,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Vehicle: demo-vehicle");

  // 5. Create policy
  const policyRef = db.collection("policies").doc("demo-policy");
  await policyRef.set({
    vehicleId: "demo-vehicle",
    borrowerId: "demo-borrower",
    organizationId: "demo-org",
    status: "ACTIVE",
    policyNumber: "POL-ABC-123456",
    policyTypes: ["AUTO"],
    coveragePeriod: {
      startDate: "2024-01-01",
      endDate: "2025-01-01",
    },
    coverages: [
      { type: "LIABILITY", limit: 100000 },
      { type: "COLLISION", deductible: 500 },
      { type: "COMPREHENSIVE", deductible: 250 },
    ],
    isLienholderListed: true,
    insuranceProvider: "State Farm",
    dashboardStatus: "GREEN",
    lastVerifiedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Policy: demo-policy (GREEN)");

  // 6. Create audit log entry
  const auditRef = db.collection("auditLog").doc();
  await auditRef.set({
    organizationId: "demo-org",
    entityType: "BORROWER",
    entityId: "demo-borrower",
    action: "CREATED",
    newValue: { firstName: "John", lastName: "Smith", loanNumber: "LN-2024-001" },
    performedBy: "demo-user",
    timestamp: Timestamp.now(),
  });
  console.log("  ✓ Audit log entry");

  console.log("\nSeed complete! Start emulators with: firebase emulators:start");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
