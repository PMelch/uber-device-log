// 3.1.24 ships declarations for its modules but omits build/index.d.ts.
declare module 'appium-ios-device' {
  export const utilities: typeof import('appium-ios-device/build/lib/utilities');
  export const services: typeof import('appium-ios-device/build/lib/services');
}
