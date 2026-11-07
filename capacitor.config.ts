import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spatialstudio.app',
  appName: 'Spatial Studio',
  webDir: 'dist',
  // The native app uses the bundled web build. Keep the live GitHub Pages
  // deployment separate so browser visitors never get a fake LiDAR scan.
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
