import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA5gT_fDsPqwvZFZsWeBCgh5uCpiVhN9Ik",
  authDomain: "canaven-2b97b.firebaseapp.com",
  projectId: "canaven-2b97b",
  storageBucket: "canaven-2b97b.firebasestorage.app",
  messagingSenderId: "139429140957",
  appId: "1:139429140957:web:05e447cbaecba9548a7e34"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
