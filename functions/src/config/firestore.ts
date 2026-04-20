import { db } from "./firebase";
import type { Organization } from "../types/organization";
import type { User } from "../types/user";
import type { Borrower } from "../types/borrower";
import type { Vehicle } from "../types/vehicle";
import type { Policy } from "../types/policy";
import type { AuditLogEntry } from "../types/audit";
import type { Notification } from "../types/notification";
import type { Invite } from "../types/invite";

const converter = <T extends { id?: string }>() => ({
  toFirestore: (data: T) => {
    const { id, ...rest } = data;
    return rest;
  },
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot): T => {
    return { id: snap.id, ...snap.data() } as T;
  },
});

export const collections = {
  organizations: db.collection("organizations").withConverter(converter<Organization>()),
  users: db.collection("users").withConverter(converter<User>()),
  borrowers: db.collection("borrowers").withConverter(converter<Borrower>()),
  vehicles: db.collection("vehicles").withConverter(converter<Vehicle>()),
  policies: db.collection("policies").withConverter(converter<Policy>()),
  auditLog: db.collection("auditLog").withConverter(converter<AuditLogEntry>()),
  notifications: db.collection("notifications").withConverter(converter<Notification>()),
  invites: db.collection("invites").withConverter(converter<Invite>()),
};
