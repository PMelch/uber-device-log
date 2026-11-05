import { en } from '../src/i18n/en';
import { startStartupSpinner } from './startup-spinner';

// Keep the entry light: show progress before loading OpenTUI, Vue or device adapters.
const spinner = process.stdin.isTTY && process.stdout.isTTY && !process.argv.some(arg => arg === '--help' || arg === '-h')
  ? startStartupSpinner(en.appLoading) : undefined;
const interrupt = () => { stop(); process.exit(130); };
const terminate = () => { stop(); process.exit(143); };
const stop = () => { spinner?.stop(); process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
try {
  const { main } = await import('./main');
  await main({ setLabel: label => spinner?.setLabel(label), stop });
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stop();
}
