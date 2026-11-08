import { Capacitor, registerPlugin } from "@capacitor/core";

const SpatialScanner = registerPlugin("SpatialScanner");

export async function isNativeARKitAvailable() {
  if (!Capacitor.isNativePlatform()) {
    return {
      available: false,
      reason: "Open Spatial Studio in its installed iOS app. Safari and GitHub Pages cannot call ARKit."
    };
  }

  try {
    const result = await SpatialScanner.isSupported();
    return result?.supported
      ? { available: true, reason: "" }
      : { available: false, reason: "ARKit world tracking is not supported on this device." };
  } catch {
    return {
      available: false,
      reason: "The native SpatialScanner plugin is not registered. Follow docs/IOS-AR-SETUP.md in Xcode."
    };
  }
}

export async function scanRoomWithARKit() {
  const availability = await isNativeARKitAvailable();
  if (!availability.available) throw new Error(availability.reason);

  const result = await SpatialScanner.scanRoom();
  if (!Array.isArray(result?.planes)) {
    throw new Error("The native scanner returned an invalid result. Please try again.");
  }
  return result;
}
