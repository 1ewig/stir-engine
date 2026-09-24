import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.GROQ_API_KEY || process.env.groq_api_key;
if (!apiKey) {
  console.error("GROQ_API_KEY or groq_api_key is not set in .env.local");
  process.exit(1);
}

async function listModels() {
  console.log("Listing available models from Groq API...");
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok) {
      console.error(`Failed to list models: HTTP ${res.status} ${res.statusText}`);
      const errText = await res.text();
      console.error(errText);
      return [];
    }
    const data = await res.json();
    return data.data || [];
  } catch (err: any) {
    console.error("Error listing models:", err.message);
    return [];
  }
}

async function testModel(modelId: string, testCases: any[]) {
  console.log(`\n================================================================`);
  console.log(`Testing Model: ${modelId}`);
  console.log(`================================================================`);

  const systemPrompt = `You are an elite FX macro policy analyst. Your role is strictly qualitative semantic classification.
DO NOT calculate scores, math, or arithmetic.
For each article, determine:
- policyBias: "HAWKISH_USD" | "DOVISH_USD" | "HAWKISH_EUR" | "DOVISH_EUR" | "NEUTRAL"
- intensity: "HIGH" | "MEDIUM" | "LOW"
- driver: Brief 3-8 word summary of the macro catalyst

Remember:
- Strong US growth / sticky US inflation / delay of Fed cuts = HAWKISH_USD (Bearish EUR/USD)
- Weaker US data / Fed rate cut bets rising = DOVISH_USD (Bullish EUR/USD)
- Sticky Eurozone inflation / ECB hiking / ECB rate cut delay = HAWKISH_EUR (Bullish EUR/USD)
- Eurozone slowdown / ECB cutting rates = DOVISH_EUR (Bearish EUR/USD)
- Watch out for negations ("Fed not expected to hike", "Hopes for rate cut fade")

Respond ONLY with a valid JSON object matching this schema:
{
  "classifications": [
    {
      "id": number,
      "policyBias": string,
      "intensity": string,
      "driver": string
    }
  ]
}`;

  const userPrompt = JSON.stringify(testCases, null, 2);

  const start = Date.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 600
      })
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[${modelId}] FAILED (HTTP ${res.status}): ${errText}`);
      return { model: modelId, success: false, error: errText, elapsed };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    console.log(`Latency: ${elapsed}ms | Prompt Tokens: ${data.usage?.prompt_tokens} | Completion Tokens: ${data.usage?.completion_tokens}`);
    console.log("Classifications Result:");
    console.log(JSON.stringify(parsed, null, 2));

    return { model: modelId, success: true, parsed, elapsed, usage: data.usage };
  } catch (err: any) {
    console.error(`[${modelId}] Error:`, err.message);
    return { model: modelId, success: false, error: err.message, elapsed: Date.now() - start };
  }
}

async function main() {
  const models = await listModels();
  console.log(`Found ${models.length} available models on Groq:`);
  models.forEach((m: any) => console.log(` - ${m.id}`));

  const testCases = [
    {
      id: 1,
      title: "Fed officials push back on rate cut expectations amid sticky US CPI",
      snippet: "Federal Reserve policymakers cautioned that resilient US consumer demand and stubbornly sticky inflation mean borrowing costs must remain higher for longer."
    },
    {
      id: 2,
      title: "ECB confirms plans to cut interest rates as Eurozone wage growth decelerates",
      snippet: "The European Central Bank signaled growing confidence that inflation is returning to its 2% target, paving the way for monetary easing despite German industrial weakness."
    },
    {
      id: 3,
      title: "US jobs growth misses forecasts as unemployment ticks up to 4.3%",
      snippet: "Nonfarm payrolls grew by significantly less than anticipated, triggering renewed speculation that the Fed may need to deliver a 50 bps cut to support the labor market."
    },
    {
      id: 4,
      title: "Fed not expected to hike further despite energy price volatility",
      snippet: "Market analysts emphasize that despite the recent oil spike, the FOMC is virtually guaranteed to hold rates steady rather than resuming policy tightening."
    }
  ];

  // Target models requested by user + close matches
  const requested = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"];
  
  for (const req of requested) {
    await testModel(req, testCases);
  }

  // Also test top high-speed Groq models if requested IDs are aliases or not found
  const fallbackCandidates = ["qwen-2.5-32b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  for (const cand of fallbackCandidates) {
    if (models.some((m: any) => m.id === cand)) {
      await testModel(cand, testCases);
    }
  }
}

main().catch(console.error);
