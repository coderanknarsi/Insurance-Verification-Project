import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, type Functions } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let functions: Functions | undefined;

function getApp() {
  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  }
  return app;
}

export function getClientAuth(): Auth {
  if (!auth) {
    auth = getAuth(getApp());
    if (useEmulators) {
      connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    }
  }
  return auth;
}

export function getClientFirestore(): Firestore {
  if (!firestore) {
    firestore = getFirestore(getApp());
    if (useEmulators) {
      connectFirestoreEmulator(firestore, "localhost", 8080);
    }
  }
  return firestore;
}

export function getClientFunctions(): Functions {
  if (!functions) {
    functions = getFunctions(getApp());
    if (useEmulators) {
      connectFunctionsEmulator(functions, "localhost", 5001);
    }
  }
  return functions;
}
