import { ProviderError, type SpeechProvider } from "./types";

/**
 * ElevenLabs text-to-speech, per the API reference consulted on 2026-10-08:
 * `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
 * header `xi-api-key`, JSON body `{ text, model_id }`, returns audio bytes.
 * No voice cloning in V1. Status: "à valider en réel".
 */
export class ElevenLabsSpeechProvider implements SpeechProvider {
  readonly name = "elevenlabs";

  constructor(
    private readonly options: {
      apiKey: string;
      voiceId: string;
      modelId: string;
      allowedVoiceIds?: string[];
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async synthesize(input: { text: string; voiceId?: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const voiceId = input.voiceId ?? this.options.voiceId;
    const allowed = this.options.allowedVoiceIds ?? [this.options.voiceId];
    if (!allowed.includes(voiceId)) {
      throw new ProviderError("voice_not_allowed", "Voix non autorisée.", "rejected");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await (this.options.fetchImpl ?? fetch)(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.options.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({ text: input.text, model_id: this.options.modelId }),
          signal: controller.signal,
          redirect: "error",
        },
      );
    } catch {
      // A TTS call may have been billed; the worker records it as unknown and
      // does not retry automatically.
      throw new ProviderError("elevenlabs_network_error", "Service de voix injoignable.", "unknown");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const outcome = res.status === 429 || res.status >= 500 ? "retryable" : "rejected";
      throw new ProviderError(`elevenlabs_${res.status}`, "La synthèse vocale a échoué.", outcome);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, mimeType: "audio/mpeg" };
  }
}
