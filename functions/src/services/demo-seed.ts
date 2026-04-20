import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { DEMO_ORG_ID } from "../constants";
import { logger } from "firebase-functions/v2";
import { OrganizationType, NotificationPreference, SubscriptionTier } from "../types/organization";
import { PolicyStatus, DashboardStatus, ComplianceIssue } from "../types/policy";
import { SubscriptionPlan } from "../types/subscription";
import { AuditAction, AuditEntityType } from "../types/audit";

const DEMO_BORROWER_IDS = ["demo-borrower", "borrower-maria", "borrower-james", "borrower-sarah"];
const DEMO_VEHICLE_IDS = ["demo-vehicle", "vehicle-maria", "vehicle-james", "vehicle-sarah"];
const DEMO_POLICY_IDS = ["demo-policy", "policy-maria", "policy-james", "policy-sarah"];

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function pastDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * Deletes all demo org data (borrowers, vehicles, policies, notifications, audit log).
 */
export async function clearDemoData(): Promise<void> {
  const db = collections.organizations.firestore;
  const batch = db.batch();

  // Delete known demo documents
  for (const id of DEMO_BORROWER_IDS) {
    batch.delete(collections.borrowers.doc(id));
  }
  for (const id of DEMO_VEHICLE_IDS) {
    batch.delete(collections.vehicles.doc(id));
  }
  for (const id of DEMO_POLICY_IDS) {
    batch.delete(collections.policies.doc(id));
  }

  // Delete any extra borrowers/vehicles/policies added by demo users
  const extraBorrowers = await collections.borrowers
    .where("organizationId", "==", DEMO_ORG_ID)
    .get();
  for (const doc of extraBorrowers.docs) {
    if (!DEMO_BORROWER_IDS.includes(doc.id)) {
      batch.delete(doc.ref);
    }
  }

  const extraVehicles = await collections.vehicles
    .where("organizationId", "==", DEMO_ORG_ID)
    .get();
  for (const doc of extraVehicles.docs) {
    if (!DEMO_VEHICLE_IDS.includes(doc.id)) {
      batch.delete(doc.ref);
    }
  }

  const extraPolicies = await collections.policies
    .where("organizationId", "==", DEMO_ORG_ID)
    .get();
  for (const doc of extraPolicies.docs) {
    if (!DEMO_POLICY_IDS.includes(doc.id)) {
      batch.delete(doc.ref);
    }
  }

  // Delete notifications for demo org
  const notifications = await collections.notifications
    .where("organizationId", "==", DEMO_ORG_ID)
    .get();
  for (const doc of notifications.docs) {
    batch.delete(doc.ref);
  }

  // Delete audit log entries for demo org
  const auditLogs = await collections.auditLog
    .where("organizationId", "==", DEMO_ORG_ID)
    .get();
  for (const doc of auditLogs.docs) {
    batch.delete(doc.ref);
  }

  await batch.commit();
  logger.info("Cleared all demo org data");
}

/**
 * Seeds the demo org with fresh sample data.
 * Creates org doc, 4 borrowers, 4 vehicles, 4 policies (GREEN/YELLOW/RED statuses).
 */
export async function seedDemoData(): Promise<void> {
  const now = Timestamp.now();

  // Organization
  await collections.organizations.doc(DEMO_ORG_ID).set({
    id: DEMO_ORG_ID,
    name: "Demo BHPH Dealership",
    type: OrganizationType.BHPH_DEALER,
    address: { street: "123 Main St", city: "Dallas", state: "TX", zip: "75201" },
    settings: {
      notificationPreference: NotificationPreference.LENDER_ONLY,
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
    subscription: { tier: SubscriptionTier.STARTER, perBorrowerRate: 3.0, activeMonitoredCount: 0 },
    stripe: {
      stripeCustomerId: "",
      plan: SubscriptionPlan.STARTER,
      status: "trialing",
      trialEnd: Math.floor(Date.now() / 1000) + 14 * 86400,
      cancelAtPeriodEnd: false,
    },
    createdAt: now,
    updatedAt: now,
  });

  // Borrowers
  const borrowers = [
    { id: "demo-borrower", firstName: "John", lastName: "Smith", email: "john.smith@example.com", phone: "+15551234567", loanNumber: "LN-2024-001" },
    { id: "borrower-maria", firstName: "Maria", lastName: "Garcia", email: "maria.garcia@example.com", phone: "+15552345678", loanNumber: "LN-2024-002" },
    { id: "borrower-james", firstName: "James", lastName: "Wilson", email: "james.wilson@example.com", phone: "+15553456789", loanNumber: "LN-2024-003" },
    { id: "borrower-sarah", firstName: "Sarah", lastName: "Chen", email: "sarah.chen@example.com", phone: "+15554567890", loanNumber: "LN-2024-004" },
  ];

  for (const b of borrowers) {
    await collections.borrowers.doc(b.id).set({
      id: b.id, organizationId: DEMO_ORG_ID, firstName: b.firstName, lastName: b.lastName,
      email: b.email, phone: b.phone, loanNumber: b.loanNumber,
      createdAt: now, updatedAt: now,
    });
  }

  // Vehicles
  const vehicles = [
    { id: "demo-vehicle", borrowerId: "demo-borrower", vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2022 },
    { id: "vehicle-maria", borrowerId: "borrower-maria", vin: "5YFBURHE8JP123456", make: "Toyota", model: "Corolla", year: 2023 },
    { id: "vehicle-james", borrowerId: "borrower-james", vin: "1FADP3F29JL234567", make: "Ford", model: "Focus", year: 2021 },
    { id: "vehicle-sarah", borrowerId: "borrower-sarah", vin: "WBAJA5C51JWA45678", make: "BMW", model: "530i", year: 2023 },
  ];

  for (const v of vehicles) {
    await collections.vehicles.doc(v.id).set({
      id: v.id, borrowerId: v.borrowerId, organizationId: DEMO_ORG_ID,
      vin: v.vin, make: v.make, model: v.model, year: v.year,
      createdAt: now, updatedAt: now,
    });
  }

  // Policies
  // GREEN: John Smith — fully compliant
  await collections.policies.doc("demo-policy").set({
    id: "demo-policy", vehicleId: "demo-vehicle", borrowerId: "demo-borrower", organizationId: DEMO_ORG_ID,
    status: PolicyStatus.ACTIVE, policyNumber: "POL-ABC-123456", policyTypes: ["AUTO"],
    coveragePeriod: { startDate: pastDate(180), endDate: futureDate(185) },
    coverages: [{ type: "LIABILITY", limit: 100000 }, { type: "COLLISION", deductible: 500 }, { type: "COMPREHENSIVE", deductible: 250 }],
    coverageItems: [
      { type: "LIABILITY", name: "Bodily Injury & Property Damage", limits: [{ type: "PER_OCCURRENCE", amount: 100000, currency: "USD" }], deductibles: [] },
      { type: "COLLISION", name: "Collision Coverage", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 500, currency: "USD" }] },
      { type: "COMPREHENSIVE", name: "Comprehensive Coverage", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 250, currency: "USD" }] },
    ],
    interestedParties: [{ name: "Demo BHPH Dealership", type: "LIEN_HOLDER", address: { addr1: "123 Main St", city: "Dallas", state: "TX", zipcode: "75201" }, loanNumber: "LN-2024-001" }],
    isLienholderListed: true, insuranceProvider: "State Farm",
    insuranceProviderDetail: { name: "State Farm", naicCode: "25178", phone: "1-800-782-8332" },
    premiumAmount: { currency: "USD", amount: 1450 }, paymentFrequency: "SEMI_ANNUAL",
    drivers: [{ firstName: "John", lastName: "Smith", fullName: "John Smith" }],
    vehicleRemovedFromPolicy: false, complianceIssues: [], dashboardStatus: DashboardStatus.GREEN,
    lastVerifiedAt: now, createdAt: now, updatedAt: now,
  });

  // YELLOW: Maria Garcia — expiring soon
  await collections.policies.doc("policy-maria").set({
    id: "policy-maria", vehicleId: "vehicle-maria", borrowerId: "borrower-maria", organizationId: DEMO_ORG_ID,
    status: PolicyStatus.ACTIVE, policyNumber: "POL-XYZ-789012", policyTypes: ["AUTO"],
    coveragePeriod: { startDate: pastDate(355), endDate: futureDate(10) },
    coverages: [{ type: "LIABILITY", limit: 50000 }, { type: "COLLISION", deductible: 1000 }, { type: "COMPREHENSIVE", deductible: 500 }],
    coverageItems: [
      { type: "LIABILITY", name: "Liability", limits: [{ type: "PER_OCCURRENCE", amount: 50000, currency: "USD" }], deductibles: [] },
      { type: "COLLISION", name: "Collision", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 1000, currency: "USD" }] },
      { type: "COMPREHENSIVE", name: "Comprehensive", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 500, currency: "USD" }] },
    ],
    interestedParties: [{ name: "Demo BHPH Dealership", type: "LIEN_HOLDER", loanNumber: "LN-2024-002" }],
    isLienholderListed: true, insuranceProvider: "GEICO",
    insuranceProviderDetail: { name: "GEICO", naicCode: "41491", phone: "1-800-861-8380" },
    premiumAmount: { currency: "USD", amount: 980 }, paymentFrequency: "MONTHLY",
    drivers: [{ firstName: "Maria", lastName: "Garcia", fullName: "Maria Garcia" }],
    vehicleRemovedFromPolicy: false, complianceIssues: [ComplianceIssue.EXPIRING_SOON], dashboardStatus: DashboardStatus.YELLOW,
    lastVerifiedAt: now, createdAt: now, updatedAt: now,
  });

  // RED: James Wilson — cancelled, no lienholder
  await collections.policies.doc("policy-james").set({
    id: "policy-james", vehicleId: "vehicle-james", borrowerId: "borrower-james", organizationId: DEMO_ORG_ID,
    status: PolicyStatus.CANCELLED, policyNumber: "POL-DEF-345678", policyTypes: ["AUTO"],
    coveragePeriod: { startDate: pastDate(200), endDate: pastDate(5) },
    coverages: [{ type: "LIABILITY", limit: 25000 }],
    coverageItems: [{ type: "LIABILITY", name: "Liability Only", limits: [{ type: "PER_OCCURRENCE", amount: 25000, currency: "USD" }], deductibles: [] }],
    interestedParties: [], isLienholderListed: false, insuranceProvider: "Progressive",
    insuranceProviderDetail: { name: "Progressive", naicCode: "24260", phone: "1-800-776-4737" },
    cancelledDate: pastDate(5), premiumAmount: { currency: "USD", amount: 620 }, paymentFrequency: "MONTHLY",
    drivers: [{ firstName: "James", lastName: "Wilson", fullName: "James Wilson" }],
    vehicleRemovedFromPolicy: false, complianceIssues: [ComplianceIssue.POLICY_CANCELLED, ComplianceIssue.MISSING_LIENHOLDER, ComplianceIssue.NO_COMPREHENSIVE, ComplianceIssue.NO_COLLISION],
    dashboardStatus: DashboardStatus.RED, lastVerifiedAt: now, createdAt: now, updatedAt: now,
  });

  // RED: Sarah Chen — missing lienholder, high deductible
  await collections.policies.doc("policy-sarah").set({
    id: "policy-sarah", vehicleId: "vehicle-sarah", borrowerId: "borrower-sarah", organizationId: DEMO_ORG_ID,
    status: PolicyStatus.ACTIVE, policyNumber: "POL-GHI-901234", policyTypes: ["AUTO"],
    coveragePeriod: { startDate: pastDate(60), endDate: futureDate(305) },
    coverages: [{ type: "LIABILITY", limit: 300000 }, { type: "COLLISION", deductible: 2500 }, { type: "COMPREHENSIVE", deductible: 2000 }],
    coverageItems: [
      { type: "LIABILITY", name: "Liability", limits: [{ type: "COMBINED_SINGLE_LIMIT", amount: 300000, currency: "USD" }], deductibles: [] },
      { type: "COLLISION", name: "Collision", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 2500, currency: "USD" }] },
      { type: "COMPREHENSIVE", name: "Comprehensive", limits: [], deductibles: [{ type: "PER_OCCURRENCE", amount: 2000, currency: "USD" }] },
    ],
    interestedParties: [], isLienholderListed: false, insuranceProvider: "Allstate",
    insuranceProviderDetail: { name: "Allstate", naicCode: "19232", phone: "1-800-255-7828" },
    premiumAmount: { currency: "USD", amount: 2100 }, paymentFrequency: "SEMI_ANNUAL",
    drivers: [{ firstName: "Sarah", lastName: "Chen", fullName: "Sarah Chen" }, { firstName: "Kevin", lastName: "Chen", fullName: "Kevin Chen" }],
    vehicleRemovedFromPolicy: false, complianceIssues: [ComplianceIssue.MISSING_LIENHOLDER, ComplianceIssue.DEDUCTIBLE_TOO_HIGH],
    dashboardStatus: DashboardStatus.RED, lastVerifiedAt: now, createdAt: now, updatedAt: now,
  });

  // Audit log entry
  await collections.auditLog.doc().set({
    organizationId: DEMO_ORG_ID, entityType: AuditEntityType.BORROWER, entityId: "demo-borrower",
    action: AuditAction.CREATED, newValue: { firstName: "John", lastName: "Smith", loanNumber: "LN-2024-001" },
    performedBy: "demo-user", timestamp: now,
  });

  logger.info("Seeded demo org with fresh data");
}
