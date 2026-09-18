import { useEffect, useRef, type MutableRefObject } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { DashboardData } from "./types";

type UseDashboardLifecycleOptions = {
  dashboard: DashboardData | null;
  refreshDashboard: () => Promise<DashboardData | undefined>;
  dragActiveRef: MutableRefObject<boolean>;
  manualSyncPollingRef: MutableRefObject<boolean>;
  invalidateDashboardRequests: () => void;
  setNotice: (message: string | null) => void;
};

export function useDashboardLifecycle({
  dashboard,
  refreshDashboard,
  dragActiveRef,
  manualSyncPollingRef,
  invalidateDashboardRequests,
  setNotice,
}: UseDashboardLifecycleOptions) {
  const previousPendingRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer = 0;

    const poll = async () => {
      if (disposed) return;
      if (dragActiveRef.current) {
        timer = window.setTimeout(poll, 800);
        return;
      }
      if (manualSyncPollingRef.current) {
        timer = window.setTimeout(poll, 900);
        return;
      }

      const next = await refreshDashboard();
      const active = next?.syncProgress?.active || (next?.queueSummary.pending ?? 0) > 0;
      if (!disposed) {
        timer = window.setTimeout(
          poll,
          active ? 1200 : document.hidden ? 8000 : 3000,
        );
      }
    };

    void poll();
    return () => {
      disposed = true;
      invalidateDashboardRequests();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!dashboard) return;

    const pending = dashboard.queueSummary.pending;
    const previous = previousPendingRef.current;
    previousPendingRef.current = pending;
    if (previous == null || previous <= 0 || pending !== 0) return;

    const failed = dashboard.queueSummary.failed;
    setNotice(
      failed > 0
        ? `La cola terminó con ${failed} transferencia${failed === 1 ? "" : "es"} con error.`
        : `Cola completada · ${dashboard.fileCount} archivo${dashboard.fileCount === 1 ? "" : "s"} sincronizado${dashboard.fileCount === 1 ? "" : "s"}.`,
    );

    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted) return;

        sendNotification({
          title: "Nuvio · Cola finalizada",
          body: failed > 0
            ? `La cola terminó con ${failed} transferencia${failed === 1 ? "" : "es"} fallida${failed === 1 ? "" : "s"}.`
            : `${dashboard.fileCount} archivo${dashboard.fileCount === 1 ? "" : "s"} sincronizado${dashboard.fileCount === 1 ? "" : "s"}.`,
        });
      } catch {
        // Notifications are optional and must never block transfers.
      }
    })();
  }, [
    dashboard?.queueSummary.pending,
    dashboard?.queueSummary.failed,
    dashboard?.queueSummary.total,
    dashboard?.fileCount,
    dashboard?.telegramConnected,
  ]);
}
