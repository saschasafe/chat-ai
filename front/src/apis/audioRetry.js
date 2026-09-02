// The upstream audio endpoints intermittently answer 500, typically when a
// model is cold. A single failure would otherwise break a whole live turn.
const RETRY_DELAYS = [400, 900];

export function isRetryableStatus(status) {
  return status >= 500 || status === 408 || status === 429;
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

/**
 * Run `attempt` and retry it on transient failures. `attempt` must throw an
 * error carrying `retryable: true` for the retry to kick in.
 */
export async function withAudioRetry(attempt, signal = null) {
  let lastError;
  for (let index = 0; index <= RETRY_DELAYS.length; index++) {
    try {
      return await attempt();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (!error?.retryable || index === RETRY_DELAYS.length) throw error;
      lastError = error;
      await wait(RETRY_DELAYS[index], signal);
    }
  }
  throw lastError;
}
