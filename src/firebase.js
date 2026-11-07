import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const NAMES = {
  apiKey: "VITE_FIREBASE_API_KEY", authDomain: "VITE_FIREBASE_AUTH_DOMAIN", projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET", messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID", appId: "VITE_FIREBASE_APP_ID",
};

/** Names of the Netlify settings that are missing, for the "Almost ready" screen. */
export const missingConfig = Object.entries(config).filter(([, v]) => !String(v || "").trim()).map(([k]) => NAMES[k]);

let app = null;
export let auth = null, db = null, storage = null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

if (!missingConfig.length) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}
