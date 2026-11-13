/**
 * Gravação de áudio no Atendimento: o navegador grava, o CRM monta um WAV (voz, 16 kHz, mono) e o envia como
 * anexo comum; o conector converte para nota de voz do WhatsApp (sendVoice com conversão). WAV funciona em todos
 * os navegadores e já é aceito pelo servidor, sem dependência nova.
 * As funções puras (downsample/encodeWav) são testadas em tests/crm-atendimento-whatsapp.test.mjs.
 */
export const VOICE_SAMPLE_RATE = 16_000;
/** 3 minutos de voz = ~5,8 MB em WAV 16 kHz, abaixo do limite de 7 MB por anexo. */
export const MAX_RECORDING_SECONDS = 180;

export function downsample(input: Float32Array, inputRate: number, outputRate = VOICE_SAMPLE_RATE): Float32Array {
  if (outputRate >= inputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    // Média do trecho (filtro simples contra serrilhado ao reduzir a taxa).
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let position = start; position < end; position++) sum += input[position]!;
    output[index] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

/** PCM 16 bits mono com cabeçalho RIFF/WAVE. */
export function encodeWav(samples: Float32Array, sampleRate = VOICE_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

export function recordingSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const audioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !audioContext) return false;
  // A política do site (Permissions-Policy) pode bloquear o microfone: nesse caso o botão nem aparece.
  const policy = (document as unknown as { permissionsPolicy?: { allowsFeature(name: string): boolean }; featurePolicy?: { allowsFeature(name: string): boolean } });
  const rules = policy.permissionsPolicy ?? policy.featurePolicy;
  return rules ? rules.allowsFeature("microphone") : true;
}

export interface VoiceRecording {
  /** Termina e devolve o arquivo WAV (ou null se nada foi captado). */
  stop(): Promise<File | null>;
  cancel(): void;
}

/** Começa a gravar. Lança erro com mensagem em português quando o microfone não está disponível. */
export async function startVoiceRecording(onLimit: () => void): Promise<VoiceRecording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new Error(
      name === "NotAllowedError" || name === "SecurityError"
        ? "O microfone não foi liberado. Permita o uso do microfone para este site (ícone ao lado do endereço) e tente de novo."
        : name === "NotFoundError"
          ? "Nenhum microfone foi encontrado neste computador."
          : "Não foi possível acessar o microfone.",
    );
  }
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor funciona em todos os navegadores sem carregar módulo extra (o CSP do site fica intacto).
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  let length = 0;
  let finished = false;
  const limit = MAX_RECORDING_SECONDS * context.sampleRate;
  processor.onaudioprocess = (event) => {
    if (finished) return;
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    length += data.length;
    if (length >= limit) onLimit();
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    finished = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
  };
  return {
    async stop() {
      if (finished) return null;
      const sampleRate = context.sampleRate;
      release();
      if (!length) return null;
      const merged = new Float32Array(Math.min(length, limit));
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= merged.length) break;
        merged.set(chunk.subarray(0, merged.length - offset), offset);
        offset += chunk.length;
      }
      const wav = encodeWav(downsample(merged, sampleRate));
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      return new File([wav], `audio-${stamp}.wav`, { type: "audio/wav" });
    },
    cancel: release,
  };
}
