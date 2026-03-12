import { Timestamp } from "firebase-admin/firestore";

export enum UserRole {
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  VIEWER = "VIEWER",
}

export interface User {
  id?: string;
  organizationId: string;
  email: string;
  displayName: string;
  role: UserRole;
  firebaseAuthUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
