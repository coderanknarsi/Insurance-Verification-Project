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
    id: "demo-org",
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
      complianceRules: {
        requireLienholder: true,
        requireComprehensive: true,
        requireCollision: true,
        maxCompDeductible: 1000,
        maxCollisionDeductible: 1000,
        expirationWarningDays: 15,
        lapseGracePeriodDays: 5,
        autoSendReminder: false,
        reminderDaysBeforeExpiry: 10,
      },
    },
    subscription: {
      tier: "STARTER",
      perBorrowerRate: 3.0,
      activeMonitoredCount: 0,
    },
    stripe: {
      stripeCustomerId: "",
      plan: "STARTER",
      status: "trialing",
      trialEnd: Math.floor(Date.now() / 1000) + 14 * 86400,
      cancelAtPeriodEnd: false,
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Organization: demo-org");

  // 2. Create user (also create in Firebase Auth emulator)
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      uid: "demo-user",
      email: "admin@demo-dealer.com",
      password: "password123",
      displayName: "Demo Admin",
    });
  } catch {
    userRecord = await admin.auth().getUser("demo-user");
  }

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

  // Helper for future dates
  const futureDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };
  const pastDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
  };

  // 3. Create borrowers
  const borrowers = [
    {
      id: "demo-borrower",
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@example.com",
      phone: "+12145551234",
      loanNumber: "LN-2024-001",
    },
    {
      id: "borrower-maria",
      firstName: "Maria",
      lastName: "Garcia",
      email: "maria.garcia@example.com",
      phone: "+12145552345",
      loanNumber: "LN-2024-002",
    },
    {
      id: "borrower-james",
      firstName: "James",
      lastName: "Wilson",
      email: "james.wilson@example.com",
      phone: "+12145553456",
      loanNumber: "LN-2024-003",
    },
    {
      id: "borrower-sarah",
      firstName: "Sarah",
      lastName: "Chen",
      email: "sarah.chen@example.com",
      phone: "+12145554567",
      loanNumber: "LN-2024-004",
    },
  ];

  for (const b of borrowers) {
    await db.collection("borrowers").doc(b.id).set({
      id: b.id,
      organizationId: "demo-org",
      firstName: b.firstName,
      lastName: b.lastName,
      email: b.email,
      phone: b.phone,
      loanNumber: b.loanNumber,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    console.log(`  ✓ Borrower: ${b.id}`);
  }

  // 4. Create vehicles
  const vehicles = [
    {
      id: "demo-vehicle",
      borrowerId: "demo-borrower",
      vin: "1HGCM82633A004352",
      make: "Honda",
      model: "Accord",
      year: 2022,
    },
    {
      id: "vehicle-maria",
      borrowerId: "borrower-maria",
      vin: "5YFBURHE8JP123456",
      make: "Toyota",
      model: "Corolla",
      year: 2023,
    },
    {
      id: "vehicle-james",
      borrowerId: "borrower-james",
      vin: "1FADP3F29JL234567",
      make: "Ford",
      model: "Focus",
      year: 2021,
    },
    {
      id: "vehicle-sarah",
      borrowerId: "borrower-sarah",
      vin: "WBAJA5C51JWA45678",
      make: "BMW",
      model: "530i",
      year: 2023,
    },
  ];

  for (const v of vehicles) {
    await db.collection("vehicles").doc(v.id).set({
      id: v.id,
      borrowerId: v.borrowerId,
      organizationId: "demo-org",
      vin: v.vin,
      make: v.make,
      model: v.model,
      year: v.year,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    console.log(`  ✓ Vehicle: ${v.id}`);
  }

  // 5. Create policies with varied statuses and enriched data
  // GREEN: John Smith — fully compliant, Active, lienholder listed
  await db.collection("policies").doc("demo-policy").set({
    id: "demo-policy",
    vehicleId: "demo-vehicle",
    borrowerId: "demo-borrower",
    organizationId: "demo-org",
    status: "ACTIVE",
    policyNumber: "POL-ABC-123456",
    policyTypes: ["AUTO"],
    coveragePeriod: {
      startDate: pastDate(180),
      endDate: futureDate(185),
    },
    coverages: [
      { type: "LIABILITY", limit: 100000 },
      { type: "COLLISION", deductible: 500 },
      { type: "COMPREHENSIVE", deductible: 250 },
    ],
    coverageItems: [
      {
        type: "LIABILITY",
        name: "Bodily Injury & Property Damage",
        limits: [{ type: "PER_OCCURRENCE", amount: 100000, currency: "USD" }],
        deductibles: [],
      },
      {
        type: "COLLISION",
        name: "Collision Coverage",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 500, currency: "USD" }],
      },
      {
        type: "COMPREHENSIVE",
        name: "Comprehensive Coverage",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 250, currency: "USD" }],
      },
    ],
    interestedParties: [
      {
        name: "Demo BHPH Dealership",
        type: "LIEN_HOLDER",
        address: { addr1: "123 Main St", city: "Dallas", state: "TX", zipcode: "75201" },
        loanNumber: "LN-2024-001",
      },
    ],
    isLienholderListed: true,
    insuranceProvider: "State Farm",
    insuranceProviderDetail: {
      name: "State Farm",
      naicCode: "25178",
      phone: "1-800-782-8332",
    },
    premiumAmount: { currency: "USD", amount: 1450 },
    paymentFrequency: "SEMI_ANNUAL",
    drivers: [{ firstName: "John", lastName: "Smith", fullName: "John Smith" }],
    vehicleRemovedFromPolicy: false,
    complianceIssues: [],
    dashboardStatus: "GREEN",
    lastVerifiedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Policy: demo-policy (GREEN — fully compliant)");

  // YELLOW: Maria Garcia — Active but expiring within 10 days
  await db.collection("policies").doc("policy-maria").set({
    id: "policy-maria",
    vehicleId: "vehicle-maria",
    borrowerId: "borrower-maria",
    organizationId: "demo-org",
    status: "ACTIVE",
    policyNumber: "POL-XYZ-789012",
    policyTypes: ["AUTO"],
    coveragePeriod: {
      startDate: pastDate(355),
      endDate: futureDate(10),
    },
    coverages: [
      { type: "LIABILITY", limit: 50000 },
      { type: "COLLISION", deductible: 1000 },
      { type: "COMPREHENSIVE", deductible: 500 },
    ],
    coverageItems: [
      {
        type: "LIABILITY",
        name: "Liability",
        limits: [{ type: "PER_OCCURRENCE", amount: 50000, currency: "USD" }],
        deductibles: [],
      },
      {
        type: "COLLISION",
        name: "Collision",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 1000, currency: "USD" }],
      },
      {
        type: "COMPREHENSIVE",
        name: "Comprehensive",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 500, currency: "USD" }],
      },
    ],
    interestedParties: [
      {
        name: "Demo BHPH Dealership",
        type: "LIEN_HOLDER",
        loanNumber: "LN-2024-002",
      },
    ],
    isLienholderListed: true,
    insuranceProvider: "GEICO",
    insuranceProviderDetail: {
      name: "GEICO",
      naicCode: "41491",
      phone: "1-800-861-8380",
    },
    premiumAmount: { currency: "USD", amount: 980 },
    paymentFrequency: "MONTHLY",
    drivers: [{ firstName: "Maria", lastName: "Garcia", fullName: "Maria Garcia" }],
    vehicleRemovedFromPolicy: false,
    complianceIssues: ["EXPIRING_SOON"],
    dashboardStatus: "YELLOW",
    lastVerifiedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Policy: policy-maria (YELLOW — expiring soon)");

  // RED: James Wilson — Cancelled, no lienholder
  await db.collection("policies").doc("policy-james").set({
    id: "policy-james",
    vehicleId: "vehicle-james",
    borrowerId: "borrower-james",
    organizationId: "demo-org",
    status: "CANCELLED",
    policyNumber: "POL-DEF-345678",
    policyTypes: ["AUTO"],
    coveragePeriod: {
      startDate: pastDate(200),
      endDate: pastDate(5),
    },
    coverages: [
      { type: "LIABILITY", limit: 25000 },
    ],
    coverageItems: [
      {
        type: "LIABILITY",
        name: "Liability Only",
        limits: [{ type: "PER_OCCURRENCE", amount: 25000, currency: "USD" }],
        deductibles: [],
      },
    ],
    interestedParties: [],
    isLienholderListed: false,
    insuranceProvider: "Progressive",
    insuranceProviderDetail: {
      name: "Progressive",
      naicCode: "24260",
      phone: "1-800-776-4737",
    },
    cancelledDate: pastDate(5),
    premiumAmount: { currency: "USD", amount: 620 },
    paymentFrequency: "MONTHLY",
    drivers: [{ firstName: "James", lastName: "Wilson", fullName: "James Wilson" }],
    vehicleRemovedFromPolicy: false,
    complianceIssues: ["POLICY_CANCELLED", "MISSING_LIENHOLDER", "NO_COMPREHENSIVE", "NO_COLLISION"],
    dashboardStatus: "RED",
    lastVerifiedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Policy: policy-james (RED — cancelled, no lienholder, missing coverages)");

  // RED: Sarah Chen — Active but missing lienholder and high deductible
  await db.collection("policies").doc("policy-sarah").set({
    id: "policy-sarah",
    vehicleId: "vehicle-sarah",
    borrowerId: "borrower-sarah",
    organizationId: "demo-org",
    status: "ACTIVE",
    policyNumber: "POL-GHI-901234",
    policyTypes: ["AUTO"],
    coveragePeriod: {
      startDate: pastDate(60),
      endDate: futureDate(305),
    },
    coverages: [
      { type: "LIABILITY", limit: 300000 },
      { type: "COLLISION", deductible: 2500 },
      { type: "COMPREHENSIVE", deductible: 2000 },
    ],
    coverageItems: [
      {
        type: "LIABILITY",
        name: "Liability",
        limits: [{ type: "COMBINED_SINGLE_LIMIT", amount: 300000, currency: "USD" }],
        deductibles: [],
      },
      {
        type: "COLLISION",
        name: "Collision",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 2500, currency: "USD" }],
      },
      {
        type: "COMPREHENSIVE",
        name: "Comprehensive",
        limits: [],
        deductibles: [{ type: "PER_OCCURRENCE", amount: 2000, currency: "USD" }],
      },
    ],
    interestedParties: [],
    isLienholderListed: false,
    insuranceProvider: "Allstate",
    insuranceProviderDetail: {
      name: "Allstate",
      naicCode: "19232",
      phone: "1-800-255-7828",
    },
    premiumAmount: { currency: "USD", amount: 2100 },
    paymentFrequency: "SEMI_ANNUAL",
    drivers: [
      { firstName: "Sarah", lastName: "Chen", fullName: "Sarah Chen" },
      { firstName: "Kevin", lastName: "Chen", fullName: "Kevin Chen" },
    ],
    vehicleRemovedFromPolicy: false,
    complianceIssues: ["MISSING_LIENHOLDER", "DEDUCTIBLE_TOO_HIGH"],
    dashboardStatus: "RED",
    lastVerifiedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  console.log("  ✓ Policy: policy-sarah (RED — missing lienholder, high deductible)");

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
