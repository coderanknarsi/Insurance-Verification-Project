import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import {
  parseInsuranceRecord,
  computeDashboardStatus,
} from "../services/insurance-parser";
import { PolicyStatus, DashboardStatus } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";

const webhookSecret = defineString("MEASUREONE_WEBHOOK_SECRET");

export const measureOneWebhook = onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Validate webhook secret
  const receivedSecret = req.headers["x-webhook-secret"] as string | undefined;
  if (!receivedSecret || receivedSecret !== webhookSecret.value()) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { event, datarequest_id } = req.body as {
    event?: string;
    datarequest_id?: string;
  };

  if (!event || !datarequest_id) {
    res.status(400).send("Missing event or datarequest_id");
    return;
  }

  // Look up policy by measureOneDataRequestId
  const policySnap = await collections.policies
    .where("measureOneDataRequestId", "==", datarequest_id)
    .limit(1)
    .get();

  if (policySnap.empty) {
    // No matching policy — acknowledge but skip processing
    res.status(200).json({ status: "ignored", reason: "no matching policy" });
    return;
  }

  const policyDoc = policySnap.docs[0];
  const policy = policyDoc.data();
  const now = Timestamp.now();

  if (event === "datarequest.report_error") {
    await collections.policies.doc(policyDoc.id).update({
      status: PolicyStatus.NOT_AVAILABLE,
      dashboardStatus: DashboardStatus.RED,
      lastVerifiedAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: policy.organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyDoc.id,
      action: AuditAction.STATUS_CHANGED,
      performedBy: "system:webhook",
      previousValue: {
        status: policy.status,
        dashboardStatus: policy.dashboardStatus,
      },
      newValue: {
        status: PolicyStatus.NOT_AVAILABLE,
        dashboardStatus: DashboardStatus.RED,
        event,
      },
    });

    res.status(200).json({ status: "processed", event });
    return;
  }

  if (
    event === "datarequest.report_complete" ||
    event === "datarequest.report_update_available"
  ) {
    // Fetch insurance details from MeasureOne
    const details = await measureOneClient.getInsuranceDetails({
      datarequest_id,
    });

    if (!details.records || details.records.length === 0) {
      res.status(200).json({ status: "processed", event, records: 0 });
      return;
    }

    // Parse the first insurance record
    const parsed = parseInsuranceRecord(details.records[0]);
    const dashboardStatus = computeDashboardStatus(
      parsed.status,
      parsed.isLienholderListed,
      parsed.coveragePeriod
    );

    const previousValue = {
      status: policy.status,
      dashboardStatus: policy.dashboardStatus,
    };

    // Update policy with parsed insurance data
    await collections.policies.doc(policyDoc.id).update({
      status: parsed.status,
      policyNumber: parsed.policyNumber ?? null,
      policyTypes: parsed.policyTypes,
      coveragePeriod: parsed.coveragePeriod ?? null,
      coverages: parsed.coverages,
      isLienholderListed: parsed.isLienholderListed,
      insuranceProvider: parsed.insuranceProvider ?? null,
      dashboardStatus,
      lastVerifiedAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: policy.organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyDoc.id,
      action:
        event === "datarequest.report_complete"
          ? AuditAction.VERIFICATION_COMPLETED
          : AuditAction.STATUS_CHANGED,
      performedBy: "system:webhook",
      previousValue,
      newValue: {
        status: parsed.status,
        dashboardStatus,
        policyNumber: parsed.policyNumber,
        isLienholderListed: parsed.isLienholderListed,
        event,
      },
    });

    res.status(200).json({ status: "processed", event, dashboardStatus });
    return;
  }

  // Unknown event — acknowledge
  res.status(200).json({ status: "ignored", reason: "unknown event" });
});
