import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.GROQ_API_KEY;

const testCases2 = [
  {
    id: 5,
    title: "German manufacturing PMI plunges unexpectedly to 42.1, deepening recession fears",
    snippet: "Output and new orders collapsed across German industrial bellwethers, raising alarms that Europe's largest economy is sliding further into contraction."
  },
  {
    id: 6,
    title: "Powell emphasizes Fed is in no rush to ease policy as labor market remains solid",
    snippet: "Speaking at a business conference, Jerome Powell stated that the US economy continues to expand at a steady pace, giving the central bank time to assess incoming data before cutting rates."
  },
  {
    id: 7,
    title: "US core inflation rises 0.4% month-over-month, beating consensus forecasts",
    snippet: "Core consumer prices picked up steam in the latest report, dashing hopes for an aggressive easing cycle and sending Treasury yields higher."
  },
  {
    id: 8,
    title: "ECB's Schnabel warns against premature interest rate cuts, citing service inflation",
    snippet: "Isabel Schnabel argued that service sector price pressures remain sticky across the Eurozone, urging governing council members to proceed with extreme caution on further rate cuts."
  }
];

const systemPrompt = `You are an elite FX macro policy analyst. Your role is strictly qualitative semantic classification.
DO NOT calculate scores, math, or arithmetic.
For each article, determine:
- policyBias: "HAWKISH_USD" | "DOVISH_USD" | "HAWKISH_EUR" | "DOVISH_EUR" | "NEUTRAL"
- intensity: "HIGH" | "MEDIUM" | "LOW"
- driver: Brief 3-8 word summary of the macro catalyst

Remember:
- Strong US data / higher inflation / Fed holding or delaying cuts = HAWKISH_USD (Bearish EUR/USD)
- Weak US data / rising Fed rate cut bets = DOVISH_USD (Bullish EUR/USD)
- German or Eurozone weakness / ECB rate cuts = DOVISH_EUR (Bearish EUR/USD)
- Sticky Eurozone service inflation / ECB resisting rate cuts = HAWKISH_EUR (Bullish EUR/USD)

Respond ONLY with valid JSON:
{
  "classifications": [
    { "id": number, "policyBias": string, "intensity": string, "driver": string }
  ]
}`;

async function run(modelId: string) {
  const start = Date.now();
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
        { role: "user", content: JSON.stringify(testCases2) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 600
    })
  });
  const elapsed = Date.now() - start;
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  console.log(`\n=== ${modelId} (${elapsed}ms) ===`);
  console.log(JSON.stringify(parsed, null, 2));
}

async function main() {
  await run("qwen/qwen3.8-27b");
  await run("openai/gpt-oss-120b");
}

main().catch(console.error);
