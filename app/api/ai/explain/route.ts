import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function configured() {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

function numbersIn(value: string) {
  return [...value.matchAll(/\b\d+(?:\.\d+)?%?\b/g)].map((match) => match[0]);
}

function unsupportedNumbers(explanation: string, evidence: string) {
  const allowed = new Set([...numbersIn(evidence), "1", "2", "3", "4"]);
  return [...new Set(numbersIn(explanation).filter((number) => !allowed.has(number)))];
}

async function runModel(prompt: string, model: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a concise evidence editor. Follow the requested format exactly. Never reveal analysis, reasoning steps, or drafting notes.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 320,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );
  const data = (await response.json()) as {
    success?: boolean;
    result?: { response?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || !data.success || !data.result?.response) {
    throw new Error(data.errors?.[0]?.message || "Cloudflare AI could not generate an explanation.");
  }
  return data.result.response.trim();
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
    const prompt = `You are the evidence-constrained explanation layer for an SEO operations workbench.
The deterministic audit engine has already made the match. You must not change its workflow, severity, or recommendation.

Explain this ${body.kind === "gsc_finding" ? "Google Search Console finding" : "content-page audit"} to a content or SEO operator.
Use exactly these four short sections:
1. Why it matters
2. What the evidence says
3. What to do next
4. How to verify the fix

Rules:
- Use plain, specific language.
- Every factual statement must be directly supported by the payload below.
- Treat missing fields as unknown. Never invent evidence, thresholds, benchmarks, percentages, ranking claims, or expected impact.
- Do not introduce any number that is not present in the payload, except the four section numbers.
- Do not upgrade labels such as "high" into "critical".
- When the payload does not prove an impact or verification threshold, say that it is unknown.
- Call out any assumption explicitly.
- Keep the entire answer under 220 words.
- Do not include a preamble or sales language.

Deterministic audit payload:
${evidence}`;

    const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
    let explanation = await runModel(prompt, model);
    let unsupported = unsupportedNumbers(explanation, evidence);
    if (unsupported.length) {
      explanation = await runModel(
        `${prompt}\n\nYour previous answer introduced unsupported numbers (${unsupported.join(", ")}). Rewrite it using only facts and numbers explicitly present in the payload.`,
        model,
      );
      unsupported = unsupportedNumbers(explanation, evidence);
    }
    if (unsupported.length) {
      console.warn("Blocked Cloudflare AI explanation with unsupported numeric claims:", unsupported);
      return NextResponse.json(
        {
          error:
            "Cloudflare AI added unsupported evidence, so the answer was blocked. The deterministic recommendation is still available.",
          guardrailBlocked: true,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      explanation,
      provider: "Cloudflare Workers AI",
      model,
      guardrail: "Deterministic audit result preserved; unsupported numeric claims blocked",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI explanation failed." },
      { status: 500 },
    );
  }
}
