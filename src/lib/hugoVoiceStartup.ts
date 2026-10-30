// Cancelling cannot dismiss a browser permission prompt. Release any late stream
// and prevent a cancelled startup from creating a gateway or changing newer state.
export function withVoiceStartupAbort<T>(operation: () => Promise<T>, signal: AbortSignal, releaseLateValue?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(signal.reason || new DOMException("Conexión cancelada", "AbortError"));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (settled) throw signal.reason;
      return operation();
    }).then(value => {
      if (settled) { releaseLateValue?.(value); return; }
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
