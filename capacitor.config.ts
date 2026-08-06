import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.b2pinternational.owner',
  appName: 'B2P Owner',
  webDir: 'dist/mobile',
  server: {
    androidScheme: 'https'
  }
};

export default config;
