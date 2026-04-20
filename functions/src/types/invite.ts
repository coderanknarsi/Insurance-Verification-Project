import { Timestamp } from "firebase-admin/firestore";
import type { UserRole } from "./user";

export enum InviteStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export interface Invite {
  id?: string;
  organizationId: string;
  email: string;
  role: UserRole;
  token: string;
  status: InviteStatus;
  invitedBy: string; // UID of the admin who sent the invite
  invitedByEmail: string;
  expiresAt: Timestamp;
  acceptedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
