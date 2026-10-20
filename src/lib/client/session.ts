"use client";

// A visitor of the chat may have no session until they become a guest there (AppState
// does it first thing). Requests made on load wait for that, instead of a 401.
let markReady: () => void = () => {};
let settled = false;
export const sessionReady = new Promise<void>((resolve) => {
  markReady = resolve;
});

/** The profile has loaded (or failed to): the session, if any, is there now. */
export function sessionSettled(): void {
  settled = true;
  markReady();
}

/** Whether a 401 may only mean the guest's session isn't there yet. */
export function sessionPending(): boolean {
  return !settled;
}
