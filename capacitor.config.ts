import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId intentionally unchanged - it's the Android applicationId/
  // Firebase-registered package identity, not user-visible branding.
  // Changing it would make this a different app to Android/Play/Firebase
  // (orphaning any existing installs and requiring a new
  // google-services.json), so only the display name changes here.
  appId: 'com.b2pinternational.owner',
  appName: 'B2P ONE',
  webDir: 'dist/mobile',
  server: {
    androidScheme: 'https'
  }
};

export default config;
