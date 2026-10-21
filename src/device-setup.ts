import type { DeviceSetup, DeviceSetupIssue, DeviceList } from '../shared/types';
import type { MessageKey } from './i18n/en';
import type { MessageParams } from '../shared/notifications';

export type SetupStep = { message: MessageKey; params?: MessageParams; commands?: string[]; link?: { label: MessageKey; url: string }; distribution?: boolean };
const tools = { label: 'setupPlatformTools' as const, url: 'https://developer.android.com/tools/releases/platform-tools' };
const apple = { label: 'setupAppleHelp' as const, url: 'https://support.apple.com/en-us/108643' };
const drivers = { label: 'setupOemHelp' as const, url: 'https://developer.android.com/studio/run/oem-usb' };
export const setupTitles: Record<DeviceSetupIssue['reason'], MessageKey> = {
  adbMissing: 'setupAndroidMissing', androidUnavailable: 'setupAndroidUnavailable',
  androidUnauthorized: 'setupUnauthorized', androidPermissions: 'setupPermissions', iosUnavailable: 'setupIosUnavailable',
};
export function setupSteps(host: DeviceSetup['host'], issue: DeviceSetupIssue): SetupStep[] {
  if (host === 'other') return [{message:'setupFallback', link: issue.platform === 'android' ? tools : apple}];
  if (issue.platform === 'ios') {
    if (host === 'windows') return [
      {message:'setupAppleWindows', link:apple}, {message:'setupTrust', params:{app:'Apple Devices'}},
      {message:'setupWindowsService', commands:['services.msc']}, {message:'setupRestart'},
    ];
    if (host === 'macos') return [
      {message:'setupTrust', params:{app:'Finder'}, commands:['open -a Finder']}, {message:'setupMacIos', link:apple}, {message:'setupRestart'},
    ];
    return [
      {message:'setupLinuxIos', distribution:true},
      {message:'setupCheckIos', commands:['idevicepair pair\nidevice_id -l']},
      {message:'setupLinuxService', commands:['systemctl status usbmuxd', 'sudo systemctl start usbmuxd']}, {message:'setupRestart'},
    ];
  }
  const steps: SetupStep[] = [];
  if (issue.reason !== 'androidUnauthorized' && issue.reason !== 'androidPermissions') {
    steps.push({message:'setupInstallAndroid', link:tools});
    if (host === 'windows') steps.push({message:'setupWindowsAdb', commands:['$env:ADB_PATH = "C:\\Android\\platform-tools\\adb.exe"\nudl']});
    else if (host === 'macos') steps.push({message:'setupMacAdb', commands:['export ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb"\nudl']});
    else steps.push({message:'setupLinuxAdb'});
  }
  if (host === 'linux' && issue.reason !== 'androidUnauthorized') steps.push({message:'setupLinuxPermissions', commands:['sudo apt-get install android-sdk-platform-tools-common', 'sudo usermod -aG plugdev "$USER"']});
  steps.push({message:'setupAuthorize'});
  // ADB_PATH is an alternative to PATH; use that same executable in verification.
  const custom = host === 'macos' && (issue.reason === 'adbMissing' || issue.reason === 'androidUnavailable');
  const windows = host === 'windows' && (issue.reason === 'adbMissing' || issue.reason === 'androidUnavailable');
  steps.push({message:'setupCheckAndroid', commands:[custom ? '"$ADB_PATH" version\n"$ADB_PATH" devices -l' : windows ? '& $env:ADB_PATH version\n& $env:ADB_PATH devices -l' : 'adb version\nadb devices -l']});
  if (host === 'windows') steps.push({message:'setupWindowsDriver', link:drivers});
  steps.push({message:'setupRestart'});
  return steps;
}

/** Older server warnings and unrelated WebView diagnostics retain their fallback. */
export function setupWarnings(warnings: DeviceList['warnings'], setup?: DeviceSetup) {
  return warnings.filter(warning => typeof warning === 'string' || warning.code !== 'discoveryUnavailable' ||
    !setup?.issues.some(issue => (issue.platform === 'android' ? 'Android' : 'iOS') === warning.params.platform));
}
