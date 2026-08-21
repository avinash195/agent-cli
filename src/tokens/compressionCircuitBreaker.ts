const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

export interface CircuitBreakerState {
  consecutiveFailures: number;
}

export function createCircuitBreaker(): CircuitBreakerState {
  return { consecutiveFailures: 0 };
}

export function recordCompressionSuccess(state: CircuitBreakerState): void {
  state.consecutiveFailures = 0;
}

export function recordCompressionFailure(state: CircuitBreakerState): void {
  state.consecutiveFailures++;
}

export function isCircuitOpen(state: CircuitBreakerState): boolean {
  return state.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
}
