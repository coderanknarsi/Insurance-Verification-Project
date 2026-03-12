import { Timestamp } from "firebase-admin/firestore";

export interface Vehicle {
  id?: string;
  borrowerId: string;
  organizationId: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
