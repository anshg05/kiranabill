import { idle } from "./idle";

// KB-352 (owner, 28 Oct 2026): what runs AFTER the receipt has painted - learning, the catalog reload, sync. One step at a time, each in
// an idle moment (so a slow step never sits in the same frame as the next, or as a keystroke), each timed for the Pilot numbers panel,
// each given up on after the cap, and a failing step never stops the next. Nothing here is ever awaited by Bill Banao.

/** A step that has not finished in this long is abandoned (it keeps running if it can; the chain moves on). */
export const AFTER_SAVE_STEP_CAP_MS = 30_000;

export interface AfterSaveSteps {
  /** Learn from the saved bill (its own transaction). */
  learn: () => Promise<unknown>;
  /** Reload the billing catalog - an alias this bill promoted reads from the very next utterance. */
  reload: () => void | Promise<void>;
  /** One sync cycle. */
  sync: () => Promise<unknown>;
}

export type AfterSavePhase = "learning" | "reload" | "sync";

export async function runAfterSave(
  steps: AfterSaveSteps,
  record: (phases: Partial<Record<AfterSavePhase, number>>) => void,
  yieldToBrowser: () => Promise<void> = () => idle(),
): Promise<void> {
  const run = async (phase: AfterSavePhase, step: () => unknown): Promise<void> => {
    await yieldToBrowser();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.resolve().then(step), new Promise<void>((resolve) => void (timer = setTimeout(resolve, AFTER_SAVE_STEP_CAP_MS)))]);
    } catch (err) {
      console.warn(`[after save] ${phase} failed:`, err instanceof Error ? err.message : err); // the bill is saved either way
    } finally {
      clearTimeout(timer);
    }
    record({ [phase]: Date.now() - started });
  };
  await run("learning", steps.learn);
  await run("reload", steps.reload);
  await run("sync", steps.sync);
}
