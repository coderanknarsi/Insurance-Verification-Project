import { httpsCallable } from "firebase/functions";
import { getClientFunctions } from "./firebase";

// ---- Types for Cloud Function inputs/outputs ----

interface CreateVerificationInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
}

interface CreateVerificationResult {
  invitationUrl: string;
  dataRequestId: string;
}

interface SendVerificationLinkInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  channel: "EMAIL" | "SMS";
}

interface SendVerificationLinkResult {
  invitationUrl: string;
  dataRequestId: string;
  notificationId: string;
  recipient: string;
}

interface GetDashboardSummaryInput {
  organizationId: string;
}

interface DashboardSummary {
  green: number;
  yellow: number;
  red: number;
  totalBorrowers: number;
}

interface GetBorrowersInput {
  organizationId: string;
  dashboardStatus?: "GREEN" | "YELLOW" | "RED";
  limit?: number;
  startAfter?: string;
}

interface BorrowerWithVehicles {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanNumber: string;
  measureOneIndividualId?: string;
  vehicles: Array<{
    id: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    policy: {
      id: string;
      status: string;
      dashboardStatus: string;
      measureOneDataRequestId?: string;
    } | null;
  }>;
  overallStatus: "GREEN" | "YELLOW" | "RED";
}

interface GetBorrowersResult {
  borrowers: BorrowerWithVehicles[];
  hasMore: boolean;
  lastId: string | null;
}

// ---- Callable function wrappers ----

export function callCreateVerificationRequest(data: CreateVerificationInput) {
  return httpsCallable<CreateVerificationInput, CreateVerificationResult>(
    getClientFunctions(),
    "createVerificationRequest"
  )(data);
}

export function callSendVerificationLink(data: SendVerificationLinkInput) {
  return httpsCallable<SendVerificationLinkInput, SendVerificationLinkResult>(
    getClientFunctions(),
    "sendVerificationLink"
  )(data);
}

export function callGetDashboardSummary(data: GetDashboardSummaryInput) {
  return httpsCallable<GetDashboardSummaryInput, DashboardSummary>(
    getClientFunctions(),
    "getDashboardSummary"
  )(data);
}

export function callGetBorrowers(data: GetBorrowersInput) {
  return httpsCallable<GetBorrowersInput, GetBorrowersResult>(
    getClientFunctions(),
    "getBorrowers"
  )(data);
}
