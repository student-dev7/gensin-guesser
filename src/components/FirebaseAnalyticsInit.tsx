"use client";

import { useEffect } from "react";
import { initFirebaseAnalytics } from "@/lib/firebaseAnalytics";

/** Firebase Console で Analytics を有効化し、NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID を設定したときだけ計測されます */
export function FirebaseAnalyticsInit() {
  useEffect(() => {
    void initFirebaseAnalytics();
  }, []);
  return null;
}
