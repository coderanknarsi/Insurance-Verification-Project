import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth";
import { UserRole } from "../types/user";

interface GetStaffTasksInput {
  organizationId: string;
  status?: "OPEN" | "RESOLVED" | "ALL";
  limit?: number;
}

export interface StaffTaskRow {
  id: string;
  organizationId: string;
  borrowerId?: string;
  borrowerName?: string;
  borrowerPhone?: string;
  borrowerEmail?: string;
  policyId?: string;
  vehicleId?: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  description?: string;
  inboundPhone?: string;
  inboundText?: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export const getStaffTasks = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as GetStaffTasksInput;
  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }
  requireOrg(user, data.organizationId);
  // Staff task rows include borrower PII and inbound SMS bodies — restrict
  // access to org leadership.
  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);

  const status = data.status ?? "OPEN";
  const limit = Math.min(data.limit ?? 100, 500);

  let query = db
    .collection("staffTasks")
    .where("organizationId", "==", data.organizationId)
    .orderBy("createdAt", "desc")
    .limit(limit);
  if (status !== "ALL") {
    query = db
      .collection("staffTasks")
      .where("organizationId", "==", data.organizationId)
      .where("status", "==", status)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }

  const snap = await query.get();

  // Hydrate borrower contact info for the queue UI
  const borrowerIds = [...new Set(
    snap.docs.map((d) => d.data().borrowerId).filter((x): x is string => !!x),
  )];
  const borrowerInfo = new Map<string, { name: string; phone?: string; email?: string }>();
  // Firestore "in" supports up to 30; chunk for safety.
  for (let i = 0; i < borrowerIds.length; i += 30) {
    const chunk = borrowerIds.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const bSnap = await collections.borrowers
      .where("__name__", "in", chunk)
      .get();
    for (const doc of bSnap.docs) {
      const b = doc.data();
      borrowerInfo.set(doc.id, {
        name: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim(),
        phone: b.phone,
        email: b.email,
      });
    }
  }

  const tasks: StaffTaskRow[] = snap.docs.map((d) => {
    const t = d.data();
    const info = t.borrowerId ? borrowerInfo.get(t.borrowerId) : undefined;
    return {
      id: d.id,
      organizationId: t.organizationId,
      borrowerId: t.borrowerId,
      borrowerName: info?.name,
      borrowerPhone: info?.phone,
      borrowerEmail: info?.email,
      policyId: t.policyId,
      vehicleId: t.vehicleId,
      type: t.type,
      status: t.status,
      priority: t.priority,
      title: t.title,
      description: t.description,
      inboundPhone: t.inboundPhone,
      inboundText: t.inboundText,
      createdAt: (t.createdAt as Timestamp)?.toMillis?.() ?? 0,
      updatedAt: (t.updatedAt as Timestamp)?.toMillis?.() ?? 0,
      resolvedAt: (t.resolvedAt as Timestamp | undefined)?.toMillis?.(),
      resolvedBy: t.resolvedBy,
    };
  });

  return { tasks };
});

interface ResolveStaffTaskInput {
  organizationId: string;
  taskId: string;
  /** When true on a BORROWER_HELP_REQUEST or INTAKE_NO_RESPONSE, also clears `needsHelp` on the borrower. */
  clearBorrowerNeedsHelp?: boolean;
}

export const resolveStaffTask = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as ResolveStaffTaskInput;
  if (!data.organizationId || !data.taskId) {
    throw new HttpsError("invalid-argument", "organizationId and taskId are required.");
  }
  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  const ref = db.collection("staffTasks").doc(data.taskId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Task not found.");
  }
  const task = snap.data()!;
  if (task.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Task belongs to a different organization.");
  }

  const now = Timestamp.now();
  await ref.update({
    status: "RESOLVED",
    resolvedAt: now,
    resolvedBy: uid,
    updatedAt: now,
  });

  if (data.clearBorrowerNeedsHelp && task.borrowerId) {
    await collections.borrowers.doc(task.borrowerId).update({
      needsHelp: false,
      needsHelpResolvedAt: now,
      updatedAt: now,
    });
  }

  return { success: true };
});
