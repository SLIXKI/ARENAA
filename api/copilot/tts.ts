
// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 30;
// In-app Copilot TTS — FULLY SELF-CONTAINED (no cross-file imports).
// Key: per-user Gemini key via x-gemini-key / userApiKey.
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { text, userApiKey } = req.body || {};
    const clientKey = (req.headers["x-gemini-key"] as string) || userApiKey;
    if (!clientKey) {
      return res.status(401).json({ error: "Login required: pehle signup me Gemini key dalo." });
    }
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey: clientKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: (text || "").slice(0, 500) }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return res.status(404).json({ error: "No audio generated" });
    }

    res.json({ audio: base64Audio });
  } catch (error: any) {
    console.error("TTS error:", error);
    res.status(500).json({ error: error.message || "TTS generation failed" });
  }
}
