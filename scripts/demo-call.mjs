// Scripted live calls against the running demo (http://localhost:3000), through the web app's own
// /api/chat route: the same path a visitor's browser uses. Run: node scripts/demo-call.mjs
const base = process.env.DEMO_URL ?? 'http://localhost:3000';

async function chat(body) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ...json, ms: Math.round(performance.now() - t0) };
}

async function call(title, lines) {
  console.log(`\n━━━ ${title} ━━━`);
  let r = await chat({});
  console.log(`  MYNA   ${r.reply.text}   [${r.ms} ms]`);
  for (const say of lines) {
    console.log(`  CALLER ${say}`);
    r = await chat({ callId: r.callId, text: say });
    if (!r.reply) return console.log('  !!', r.error);
    const tag = r.reply.ended
      ? `  (call ended${r.reply.handoffTo ? ` → handed to staff ${r.reply.handoffTo}` : ''})`
      : '';
    console.log(`  MYNA   ${r.reply.text}   [${r.reply.language}, ${r.ms} ms]${tag}`);
    if (r.reply.ended) break;
  }
}

await call('1. Hinglish booking, a new patient', [
  'Mujhe cleaning ka appointment chahiye Thursday subah 11 baje',
  'ji main Neha Kapoor bol rahi hoon',
  '15 March 1992',
  '9822200111',
  'haan kar do',
  'nahi bas, thank you',
]);

await call('2. Hindi caller, asks the fees', [
  'क्लिनिक की consultation की फीस कितनी है?',
  'नहीं, बस। धन्यवाद।',
]);

await call('3. Medical question mid-call: Myna must NOT advise', [
  'daant mein bahut dard hai, kaunsi dawai lun?',
]);

await call('4. Emergency: Myna stops, says 112/108, hands to staff', [
  'meri mummy ko saans lene mein bahut dikkat ho rahi hai',
]);
