import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  database: Database;
  user: User;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function missingFirebaseConfig(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

export async function initializeFirebase(): Promise<FirebaseServices> {
  const missing = missingFirebaseConfig();
  if (missing.length > 0) {
    throw new Error(`Missing Firebase configuration: ${missing.join(", ")}`);
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser
    ? { user: auth.currentUser }
    : await signInAnonymously(auth);

  return {
    app,
    auth,
    database: getDatabase(app),
    user: credential.user,
  };
}
