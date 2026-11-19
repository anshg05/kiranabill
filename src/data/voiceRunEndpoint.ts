import { APP_VERSION_CODE } from "./appVersion";
import { submitRecording, type SubmitRecordingOptions, type VoiceJobOutcome } from "./voiceJob";

/**
 * Option (b) step 3 (owner, 18 Nov 2026): where the phone starts the voice job. The WEBSITE build leaves VITE_VOICE_RUN_URL unset and
 * calls /voice-run on its own site, as before; the Android APP build (its screens come from the APK, origin https://localhost) sets it to
 * the functions site's full address. (Its own file: voiceJob.ts is also compiled for scripts/, which has no Vite env.)
 */
export const voiceRunEndpoint = (): string => import.meta.env.VITE_VOICE_RUN_URL || "/voice-run";

/** The billing screen's call: submitRecording at this build's address, recording this build's versionCode (D116). */
export const submitAppRecording = (opts: Omit<SubmitRecordingOptions, "endpoint" | "appVersionCode">): Promise<VoiceJobOutcome> =>
  submitRecording({ ...opts, endpoint: voiceRunEndpoint(), appVersionCode: APP_VERSION_CODE });
