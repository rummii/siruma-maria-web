"use client";

import { useEffect } from "react";

export function CacheReset() {
  useEffect(() => {
    if ("caches" in window) {
      void caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))));
    }
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
    }
  }, []);

  return null;
}
