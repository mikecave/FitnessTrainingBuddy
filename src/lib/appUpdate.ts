// Deciding whether to reload onto a newly activated service worker.
//
// Extracted as a pure function because the failure mode is severe: get the
// guards wrong and the app reloads in a loop, which is far worse than being one
// version behind. The rules:
//
//  - A first install must NOT reload. Registering a service worker for the very
//    first time also fires `controllerchange` (null -> first controller); acting
//    on that would reload every first visit for no reason.
//  - Reload at most once per page life, so a misbehaving worker cannot loop.
//  - Never mid-workout: a reload discards whatever is typed into a set row that
//    has not been confirmed yet.

export interface UpdateReloadContext {
  /** Was a service worker already in control before this change? */
  hadController: boolean;
  /** Has this page already reloaded for an update? */
  alreadyReloaded: boolean;
  /** Is a workout currently open on screen? */
  inSession: boolean;
}

export function shouldReloadForUpdate(ctx: UpdateReloadContext): boolean {
  if (!ctx.hadController) return false;
  if (ctx.alreadyReloaded) return false;
  if (ctx.inSession) return false;
  return true;
}
