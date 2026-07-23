import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "@cf/meta/llama-3.2-3b-instruct";

function configured() {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

export async function GET() {
  return NextResponse.json({
    enabled: configured(),
    provider: "Cloudflare Workers AI",
    model: env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL,
  });
}

export async function POST(request: Request) {
  if (!configured()) {
    return NextResponse.json(
      {
        error:
          "Cloudflare AI is not configured yet. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN as server-side runtime values.",
        configurationRequired: true,
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      kind?: "content_piece" | "gsc_finding";
      subject?: Record<string, unknown>;
    };
    if (!body.subject || !body.kind) {
      return NextResponse.json({ error: "An audit finding is required." }, { status: 400 });
    }

    const evidence = JSON.stringify(body.subject).slice(0, 12_000);
    const prompt = `You are the explanation layer for an SEO operations workbench.
The deterministic audit engine has already made the match. You must not change its workflow, severity, or recommendation.

Explain this ${body.kind === "gsc_finding" ? "Google Search Console finding" : "content-page audit"} to a content or SEO operator.
Use exactly these four short sections:
1. Why it matters
2. What the evidence says
3. What to do next
4. How to verify the fix

Rules:
- Use plain, specific language.
- Treat missing fields as unknown; never invent evidence.
- Call out any assumption explicitly.
- Keep the entire answer under 220 words.
- Do not include a preamble or sales language.

Deterministic audit payload:
${evidence}`;

    const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt, max_tokens: 450, temperature: 0.2 }),
        signal: AbortSignal.timeout(25_000),
      },
    );
    const data = (await response.json()) as {
      success?: boolean;
      result?: { response?: string };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || !data.success || !data.result?.response) {
      const message = data.errors?.[0]?.message || "Cloudflare AI could not generate an explanation.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({
      explanation: data.result.response.trim(),
      provider: "Cloudflare Workers AI",
      model,
      guardrail: "Deterministic audit result preserved",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI explanation failed." },
      { status: 500 },
    );
  }
}
