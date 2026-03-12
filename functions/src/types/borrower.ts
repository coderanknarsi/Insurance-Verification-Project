import { Timestamp } from "firebase-admin/firestore";

export interface Borrower {
  id?: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  measureOneIndividualId?: string;
  loanNumber: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
