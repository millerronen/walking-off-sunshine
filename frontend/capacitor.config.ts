import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.walkingoffsunshine.app',
  appName: 'HolechBaTzel',
  webDir: 'dist',
  packageClassList: ['com.capacitorjs.plugins.geolocation.GeolocationPlugin'],
  plugins: {
    Keyboard: {
      resize: 'none',   // keyboard overlays content — no viewport resize, no layout jump
      scrollAssist: false,
    },
  },
};

export default config;
