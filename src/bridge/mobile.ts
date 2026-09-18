import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { getPlatform } from "./shared";

export async function listenMobileBack(handler: () => void): Promise<() => void> {
  if ((await getPlatform()) !== "android") return () => {};
  const listener = await onBackButtonPress(handler);
  return () => { void listener.unregister(); };
}

export function backgroundApp(): Promise<void> {
  return invoke("background_app");
}

export async function ensureMobileNotificationPermission(): Promise<boolean> {
  try {
    if ((await getPlatform()) !== "android") return true;
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    // Permission denial or an unavailable notification plugin must never block uploads.
    return false;
  }
}
