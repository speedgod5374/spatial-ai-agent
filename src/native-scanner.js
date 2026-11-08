import { Capacitor, registerPlugin } from '@capacitor/core';

const SpatialScanner = registerPlugin('SpatialScanner');

/**
 * Starts the native ARKit scanner. The browser build intentionally does not
 * fall back to getUserMedia because a camera preview is not a room scan.
 */
export async function scanRoomWithARKit() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('ARKit scanning is only available in the installed iOS app. A browser camera preview cannot create a 3D room scan.');
  }

  const result = await SpatialScanner.startScan();
  if (!Array.isArray(result?.planes) || result.planes.length === 0) {
    throw new Error('No floor or wall surfaces were detected. Try scanning again with better lighting and slower movement.');
  }

  return result;
}
