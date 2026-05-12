"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

export function SyncOnLoad() {
  useEffect(() => {
    api.syncGarmin();
  }, []);

  return null;
}
