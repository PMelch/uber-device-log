interface SpinnerOutput {
  write(text: string): void;
  schedule(callback: () => void): () => void;
}

export function startStartupSpinner(label: string, output: SpinnerOutput = {
  write: text => { process.stdout.write(text); },
  schedule: callback => { const timer = setInterval(callback, 80); timer.unref(); return () => clearInterval(timer); },
}) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0, stopped = false;
  const draw = () => { if (!stopped) output.write(`\r\x1b[2K${frames[frame++ % frames.length]} ${label}`); };
  draw();
  const cancel = output.schedule(draw);
  return {
    setLabel(value: string) { label = value; draw(); },
    stop() { if (stopped) return; stopped = true; cancel(); output.write('\r\x1b[2K'); },
  };
}
