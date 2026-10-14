/* node functions/lib/llm.test.js — exits 1 on the first failure it lists.
   Two local servers stand in for the two providers (ANTHROPIC_API_BASE, GEMINI_API_BASE); nothing here
   reaches either of them or costs money. */

const http = require('http');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* one stub per provider: each answers the next step of its own script and remembers what it was sent */
function provider(write) {
  var p = { script: [], seen: [], held: [] };
  p.server = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      p.seen.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      var step = p.script.shift() || { status: 500, body: '{}' };
      if (step.hang) { p.held.push(res); return; }
      write(res, step);
    });
  });
  return p;
}
var claude = provider(function (res, step) {
  if (step.status !== 200) { res.writeHead(step.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(step.body || { type: 'error', error: { type: 'api_error', message: 'x' } })); }
  var events = step.events || [
    { type: 'message_start', message: { usage: { input_tokens: 4 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.text } },
    { type: 'message_delta', delta: { stop_reason: step.stop || 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' }
  ];
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(events.map(function (e) { return 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n'; }).join(''));
});
var gemini = provider(function (res, step) {
  res.writeHead(step.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(step.status === 200 ? { candidates: [{ content: { parts: [{ text: step.text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } } : (step.body || {})));
});
function fromClaude(text, stop) { return { status: 200, text: text === undefined ? '{"a":"claude"}' : text, stop: stop }; }
function fromGemini() { return { status: 200, text: '{"a":"gemini"}' }; }

var logged = [];
var realLog = console.log, realError = console.error;
function captureLogs() { console.log = console.error = function (line) { logged.push(String(line)); }; }
function releaseLogs() { console.log = realLog; console.error = realError; }

var SCHEMA = { type: 'OBJECT', properties: { a: { type: 'STRING' } } };
var ENV = ['ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'CLAUDE_MODEL', 'CLAUDE_MODEL_PLAN_STRUCTURE', 'CLAUDE_MODEL_CHAT_EDIT'];

async function run() {
  await new Promise(function (r) { claude.server.listen(0, '127.0.0.1', r); });
  await new Promise(function (r) { gemini.server.listen(0, '127.0.0.1', r); });
  process.env.ANTHROPIC_API_BASE = 'http://127.0.0.1:' + claude.server.address().port;
  process.env.GEMINI_API_BASE = 'http://127.0.0.1:' + gemini.server.address().port;
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  ENV.forEach(function (name) { delete process.env[name]; });
  const { callJson, activeProvider, describeModels, PROFILES } = require('./llm');
  var LIMITS = require('./llm').LIMITS || {};
  const { GEMINI_TEXT_MODEL } = require('./gemini');
  const { CLAUDE_OPUS, CLAUDE_SONNET, CLAUDE_HAIKU } = require('./claude');

  /* one call with the environment and the two scripts as given */
  async function ask(env, claudeSteps, geminiSteps, opts) {
    ENV.forEach(function (name) { delete process.env[name]; });
    Object.keys(env || {}).forEach(function (name) { process.env[name] = env[name]; });
    claude.script = (claudeSteps || []).slice(); gemini.script = (geminiSteps || []).slice(); claude.seen = []; gemini.seen = []; logged = [];
    captureLogs();
    try { return await callJson('prompt text', SCHEMA, Object.assign({ eventId: 'qa-x', user: 'u@example.com' }, opts || {})); }
    finally { releaseLogs(); }
  }
  function llmLines() { return logged.filter(function (l) { return /"at":"llm"/.test(l); }).map(function (l) { return JSON.parse(l); }); }
  var KEYED = { ANTHROPIC_API_KEY: 'sk-test-key-456' };
  var r;

  /* the profiles */
  var want = {
    'plan-structure': [CLAUDE_OPUS, 'medium', 120000, 20000], 'generate-content': [CLAUDE_OPUS, 'low', 120000, 28000], 'redesign-section': [CLAUDE_SONNET, 'low', 120000, 28000],
    'chat-edit': [CLAUDE_SONNET, 'low', 75000, 12000], 'suggest-design': [CLAUDE_SONNET, 'low', 75000, 12000], 'extract-brief': [CLAUDE_HAIKU, 'low', 90000, 12000],
    'ingest-source': [CLAUDE_HAIKU, 'low', 75000, 12000], 'logo-unit': [CLAUDE_SONNET, 'low', 45000, 6000], 'default': [CLAUDE_SONNET, 'low', 75000, 12000]
  };
  ok(Object.keys(PROFILES).sort().join() === Object.keys(want).sort().join(), 'the profiles are the routes we know', Object.keys(PROFILES).join());
  Object.keys(want).forEach(function (route) {
    var p = PROFILES[route] || {};
    ok(p.model === want[route][0] && p.effort === want[route][1] && p.timeoutMs === want[route][2] && p.maxOutputTokens === want[route][3], 'profile ' + route, JSON.stringify(p));
  });

  /* no key: Gemini only */
  r = await ask({}, [fromClaude()], [fromGemini()], { route: 'chat-edit', timeoutMs: 30000, maxOutputTokens: 4096 });
  ok(activeProvider() === 'gemini', 'no key: the active provider is gemini');
  ok(r.parsed && r.parsed.a === 'gemini' && r.provider === 'gemini' && r.model === GEMINI_TEXT_MODEL && r.fellBack === undefined && r.firstCode === undefined, 'no key: Gemini answers, and it is not a fallback', JSON.stringify(r));
  ok(claude.seen.length === 0 && gemini.seen.length === 1, 'no key: zero Claude requests, one Gemini request', claude.seen.length + ' / ' + gemini.seen.length);
  ok(gemini.seen[0].body.generationConfig.maxOutputTokens === 4096 && gemini.seen[0].body.generationConfig.responseSchema.type === 'OBJECT', 'no key: Gemini gets the caller\'s own numbers and schema');
  ok(llmLines().length === 0, 'no key: no llm log line');
  ok(describeModels().provider === 'gemini' && describeModels().text.indexOf(GEMINI_TEXT_MODEL) !== -1 && !/claude/i.test(describeModels().text), 'no key: describeModels names Gemini only', JSON.stringify(describeModels()));

  /* key set: Claude answers */
  r = await ask(KEYED, [fromClaude()], [fromGemini()], { route: 'chat-edit', timeoutMs: 30000, maxOutputTokens: 4096 });
  ok(activeProvider() === 'claude', 'key set: the active provider is claude');
  ok(r.parsed && r.parsed.a === 'claude' && r.provider === 'claude' && r.model === CLAUDE_SONNET && r.fellBack === undefined, 'key set: Claude answers', JSON.stringify(r));
  ok(claude.seen.length === 1 && gemini.seen.length === 0, 'key set: one Claude request, zero Gemini requests', claude.seen.length + ' / ' + gemini.seen.length);
  ok(claude.seen[0].body.max_tokens === 12000 && claude.seen[0].body.output_config.effort === 'low', 'key set: Claude gets the profile\'s numbers, not the caller\'s Gemini ones', JSON.stringify(claude.seen[0].body).slice(0, 160));
  ok(llmLines().length === 0, 'key set: no llm log line when nothing fell back');
  var d = describeModels();
  ok(d.provider === 'claude' && d.text.indexOf(CLAUDE_OPUS) !== -1 && d.text.indexOf(CLAUDE_SONNET) !== -1 && d.text.indexOf(GEMINI_TEXT_MODEL) !== -1 && /fallback/.test(d.text), 'key set: describeModels names Claude with Gemini as the fallback', JSON.stringify(d));

  /* the model per route, and the overrides */
  for (var route of Object.keys(want)) {
    await ask(KEYED, [fromClaude()], [], { route: route });
    var sent = claude.seen[0].body;
    ok(sent.model === want[route][0] && sent.output_config.effort === want[route][1] && sent.max_tokens === want[route][3], 'route ' + route + ' uses its profile', sent.model + ' ' + sent.output_config.effort + ' ' + sent.max_tokens);
  }
  await ask(KEYED, [fromClaude()], [], { route: 'never-heard-of-it' });
  ok(claude.seen[0].body.model === CLAUDE_SONNET && claude.seen[0].body.max_tokens === 12000, 'an unknown route uses the default profile');
  await ask(KEYED, [fromClaude()], [], {});
  ok(claude.seen[0].body.model === CLAUDE_SONNET && claude.seen[0].body.max_tokens === 12000, 'no route uses the default profile');
  r = await ask({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-x' }, [fromClaude()], [], { route: 'plan-structure' });
  ok(claude.seen[0].body.model === 'claude-x' && r.model === 'claude-x' && claude.seen[0].body.output_config.effort === 'medium', 'CLAUDE_MODEL changes the model of every route, and only the model', claude.seen[0].body.model);
  await ask({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-x' }, [fromClaude()], [], { route: 'chat-edit' });
  ok(claude.seen[0].body.model === 'claude-x', 'CLAUDE_MODEL: another route too');
  await ask({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-x', CLAUDE_MODEL_PLAN_STRUCTURE: 'claude-plan' }, [fromClaude()], [], { route: 'plan-structure' });
  ok(claude.seen[0].body.model === 'claude-plan', 'CLAUDE_MODEL_PLAN_STRUCTURE wins for its route', claude.seen[0].body.model);
  ok(describeModels().text.indexOf('claude-plan') !== -1 && describeModels().text.indexOf('claude-x') !== -1, 'describeModels follows the overrides', describeModels().text);
  await ask({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL_PLAN_STRUCTURE: 'claude-plan' }, [fromClaude()], [], { route: 'generate-content' });
  ok(claude.seen[0].body.model === CLAUDE_OPUS, 'CLAUDE_MODEL_PLAN_STRUCTURE leaves the other routes alone', claude.seen[0].body.model);

  /* LLM_PROVIDER=gemini */
  r = await ask({ ANTHROPIC_API_KEY: 'k', LLM_PROVIDER: 'gemini' }, [fromClaude()], [fromGemini()], { route: 'chat-edit' });
  ok(activeProvider() === 'gemini' && r.parsed.a === 'gemini' && r.fellBack === undefined && claude.seen.length === 0 && gemini.seen.length === 1, 'LLM_PROVIDER=gemini: Gemini only, even with a key', JSON.stringify(r));
  ok(describeModels().provider === 'gemini', 'LLM_PROVIDER=gemini: describeModels says so');

  /* every way Claude can fail -> Gemini answers */
  var ways = {
    'ai-quota': [{ status: 429 }], 'ai-config': [{ status: 401 }], 'ai-unavailable': [{ status: 502 }],
    'ai-rejected': [{ status: 400 }, { status: 400 }],                    // strict refused, then plain refused
    'ai-blocked': [fromClaude('no', 'refusal')], 'ai-bad-output': [fromClaude('not json')],
    'ai-timeout': [{ hang: true }]
  };
  for (var code of Object.keys(ways)) {
    var hung = code === 'ai-timeout';
    /* a timeout needs a short one, and Claude's comes from the profile: shorten it for this one call */
    var realTimeoutMs = PROFILES['chat-edit'].timeoutMs;
    if (hung) PROFILES['chat-edit'].timeoutMs = 1200;
    var started = Date.now();
    try { r = await ask(KEYED, ways[code], [fromGemini()], { route: 'chat-edit', maxOutputTokens: 1234, timeoutMs: 30000, deadlineAt: Date.now() + 60000 }); }
    finally { PROFILES['chat-edit'].timeoutMs = realTimeoutMs; }
    ok(r.parsed && r.parsed.a === 'gemini' && r.provider === 'gemini' && r.model === GEMINI_TEXT_MODEL && r.fellBack === true && r.firstCode === code && !r.code,
      'Claude ' + code + ': Gemini answers, marked as a fallback', JSON.stringify(r) + ' after ' + (Date.now() - started) + ' ms');
    ok(claude.seen.length === ways[code].length && gemini.seen.length === 1, 'Claude ' + code + ': the requests each provider saw', claude.seen.length + ' / ' + gemini.seen.length);
    var lines = llmLines();
    ok(lines.length === 1 && lines[0].route === 'chat-edit' && lines[0].eventId === 'qa-x' && lines[0].provider === 'gemini' && lines[0].fellBack === true && lines[0].firstCode === code,
      'Claude ' + code + ': one llm log line saying who answered and why', logged.join(' || '));
    ok(logged.filter(function (l) { return /"at":"claude"/.test(l); }).length === 1 && logged.filter(function (l) { return /"at":"gemini"/.test(l); }).length === 1, 'Claude ' + code + ': each provider logged its own call once');
    ok(logged.join('').indexOf('sk-test-key-456') === -1 && logged.join('').indexOf('gemini-test-key') === -1, 'Claude ' + code + ': no key in any log line');
    ok(gemini.seen[0].body.generationConfig.maxOutputTokens === 1234, 'Claude ' + code + ': the fallback gets the caller\'s Gemini numbers');
  }

  /* both fail: Gemini's failure, marked */
  r = await ask(KEYED, [{ status: 429 }], [{ status: 403 }], { route: 'chat-edit' });
  ok(r.code === 'ai-config' && r.status === 503 && r.provider === 'gemini' && r.fellBack === true && r.firstCode === 'ai-quota' && !r.parsed && typeof r.error === 'string', 'both fail: the Gemini failure, with fellBack and firstCode', JSON.stringify(r));
  ok(!/[Aa]nthropic|Claude|Gemini API|sk-test-key-456|gemini-test-key|127\.0\.0\.1|API_KEY/.test(JSON.stringify(r)), 'both fail: nothing of either provider or key in the result', JSON.stringify(r));
  ok(claude.seen.length === 1 && gemini.seen.length === 1 && llmLines().length === 1 && llmLines()[0].code === 'ai-config', 'both fail: one request each, one llm line', logged.join(' || '));

  /* too close to the deadline for a second model */
  r = await ask(KEYED, [{ status: 429 }], [fromGemini()], { route: 'chat-edit', deadlineAt: Date.now() + 4000 });
  ok(r.code === 'ai-quota' && r.provider === 'claude' && r.fellBack === undefined && r.firstCode === undefined, 'deadline too close: the Claude failure is returned as it is', JSON.stringify(r));
  ok(claude.seen.length === 1 && gemini.seen.length === 0 && llmLines().length === 0, 'deadline too close: zero Gemini requests', claude.seen.length + ' / ' + gemini.seen.length);
  r = await ask(KEYED, [fromClaude()], [fromGemini()], { route: 'chat-edit', deadlineAt: Date.now() + 500 });
  ok(r.code === 'ai-timeout' && r.provider === 'claude' && claude.seen.length === 0 && gemini.seen.length === 0, 'deadline passed: no request to either', JSON.stringify(r));

  /* the whole call is bounded even when the caller names no deadline: the function that runs it is stopped at 240 s */
  ok(LIMITS.budgetMs === 225000 && LIMITS.fallbackNeedsMs === 5000, 'the call\'s own budget is 225 s, under the function\'s 240 s', JSON.stringify(LIMITS));
  ok(Object.keys(PROFILES).every(function (route) { return PROFILES[route].timeoutMs < LIMITS.budgetMs; }), 'every profile\'s timeout is inside the budget');
  async function bounded(limits, claudeTimeoutMs, claudeSteps, geminiSteps, opts) {
    var real = { budgetMs: LIMITS.budgetMs, fallbackNeedsMs: LIMITS.fallbackNeedsMs, timeoutMs: PROFILES['chat-edit'].timeoutMs };
    Object.assign(LIMITS, limits); PROFILES['chat-edit'].timeoutMs = claudeTimeoutMs;
    var started = Date.now(), out;
    try { out = await ask(KEYED, claudeSteps, geminiSteps, Object.assign({ route: 'chat-edit' }, opts)); }
    finally { LIMITS.budgetMs = real.budgetMs; LIMITS.fallbackNeedsMs = real.fallbackNeedsMs; PROFILES['chat-edit'].timeoutMs = real.timeoutMs; }
    return { r: out, ms: Date.now() - started };
  }
  var b = await bounded({ budgetMs: 2500 }, 2100, [{ hang: true }], [{ hang: true }], { timeoutMs: 1000 });
  ok(b.r.code === 'ai-timeout' && b.r.provider === 'claude' && b.r.fellBack === undefined && gemini.seen.length === 0 && llmLines().length === 0,
    'no deadline, Claude times out, Gemini\'s timeout no longer fits: the timeout is returned, no second model', JSON.stringify(b.r) + ' gemini saw ' + gemini.seen.length);
  ok(b.ms >= 2000 && b.ms < 2500, 'no deadline, both hang: the call ends inside its budget (' + b.ms + ' ms)');
  b = await bounded({ budgetMs: 2000 }, 5000, [{ hang: true }], [fromGemini()], { timeoutMs: 1000 });
  ok(b.r.code === 'ai-timeout' && b.r.provider === 'claude' && gemini.seen.length === 0 && b.ms >= 1900 && b.ms < 2600, 'no deadline: the budget cuts a Claude timeout that is longer than it (' + b.ms + ' ms)', JSON.stringify(b.r));
  b = await bounded({ budgetMs: 3000, fallbackNeedsMs: 500 }, 2000, [{ status: 429 }], [{ hang: true }], { timeoutMs: 60000 });
  ok(b.r.code === 'ai-timeout' && b.r.provider === 'gemini' && b.r.fellBack === true && b.r.firstCode === 'ai-quota' && gemini.seen.length === 1, 'no deadline: the fallback is asked', JSON.stringify(b.r));
  ok(b.ms >= 2800 && b.ms < 3500, 'no deadline: the fallback gets what is left of the budget, not its own full timeout (' + b.ms + ' ms)');
  b = await bounded({}, 1200, [{ hang: true }], [fromGemini()], {});
  ok(b.r.parsed && b.r.parsed.a === 'gemini' && b.r.fellBack === true && b.r.firstCode === 'ai-timeout', 'no deadline: after a Claude timeout Gemini is asked while its own timeout fits', JSON.stringify(b.r));
  b = await bounded({}, 1200, [{ hang: true }], [fromGemini()], { timeoutMs: 20000, deadlineAt: Date.now() + 10000 });
  ok(b.r.code === 'ai-timeout' && b.r.provider === 'claude' && b.r.fellBack === undefined && gemini.seen.length === 0, 'a caller\'s deadline: after a Claude timeout Gemini is not asked when its timeout does not fit', JSON.stringify(b.r));
  b = await bounded({}, 1200, [{ status: 429 }], [fromGemini()], { timeoutMs: 20000, deadlineAt: Date.now() + 10000 });
  ok(b.r.parsed && b.r.fellBack === true && b.r.firstCode === 'ai-quota', 'a caller\'s deadline: a failure that was not a timeout still falls back', JSON.stringify(b.r));

  /* the file and the pictures reach both, each in its own shape */
  var extras = { route: 'extract-brief', inlineFile: { mimeType: 'application/pdf', data: 'JVBERg==' }, images: [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }] };
  r = await ask(KEYED, [{ status: 502 }], [fromGemini()], extras);
  var blocks = claude.seen[0].body.messages[0].content, parts = gemini.seen[0].body.contents[0].parts;
  ok(blocks.length === 3 && blocks[0].type === 'document' && blocks[0].source.media_type === 'application/pdf' && blocks[0].source.data === 'JVBERg==' && blocks[1].type === 'image' && blocks[1].source.media_type === 'image/png' && blocks[1].source.data === 'iVBORw0KGgo=' && blocks[2].text === 'prompt text',
    'Claude gets the file and the picture as document and image blocks', JSON.stringify(blocks));
  ok(parts.length === 3 && parts[0].text === 'prompt text' && parts[1].inlineData.mimeType === 'application/pdf' && parts[1].inlineData.data === 'JVBERg==' && parts[2].inlineData.mimeType === 'image/png' && parts[2].inlineData.data === 'iVBORw0KGgo=',
    'Gemini gets the same file and picture as inlineData parts', JSON.stringify(parts));
  ok(r.fellBack === true && r.parsed.a === 'gemini', 'and the fallback answers');
  ok(claude.seen[0].body.output_config.format.schema.type === 'object' && gemini.seen[0].body.generationConfig.responseSchema.type === 'OBJECT' && SCHEMA.type === 'OBJECT', 'each provider gets the schema in its own dialect; ours is untouched');
  ['claude', 'gemini'].forEach(function (who) {
    var threw = false;
    ENV.forEach(function (name) { delete process.env[name]; });
    if (who === 'claude') process.env.ANTHROPIC_API_KEY = 'k';
    claude.seen = []; gemini.seen = [];
    try { callJson('p', SCHEMA, { inlineFile: { mimeType: 'image/png', data: 'AAAA' } }); } catch (e) { threw = true; }
    ok(threw && claude.seen.length === 0 && gemini.seen.length === 0, 'a caller\'s mistake throws the same way with ' + who + ' first');
  });

  /* onUsage: told once per provider asked, never the reason a call fails */
  var told = [];
  r = await ask(KEYED, [fromClaude()], [fromGemini()], { route: 'chat-edit', onUsage: function (u) { told.push(u); } });
  ok(told.length === 1 && told[0].provider === 'claude' && typeof told[0].usd === 'number', 'onUsage: Claude answered, told once with its cost', JSON.stringify(told));
  told = [];
  r = await ask(KEYED, [{ status: 429 }], [fromGemini()], { route: 'chat-edit', timeoutMs: 30000, deadlineAt: Date.now() + 60000, onUsage: function (u) { told.push(u); } });
  ok(!r.code && told.length === 2 && told[0].provider === 'claude' && told[1].provider === 'gemini' && told[1].usd === null, 'onUsage: Claude failed and Gemini answered, told once for each', JSON.stringify(told));
  told = [];
  r = await ask({}, [], [fromGemini()], { route: 'chat-edit', onUsage: function (u) { told.push(u); } });
  ok(told.length === 1 && told[0].provider === 'gemini', 'onUsage: without a key, told about Gemini', JSON.stringify(told));
  r = await ask(KEYED, [fromClaude()], [], { route: 'chat-edit', onUsage: function () { throw new Error('recorder broke'); } });
  ok(!r.code && r.parsed && r.parsed.a === 'claude', 'onUsage throwing does not cost the answer', JSON.stringify(r));

  [claude, gemini].forEach(function (p) {
    p.held.forEach(function (res) { try { res.destroy(); } catch (e) {} });
    p.server.closeAllConnections && p.server.closeAllConnections();
    p.server.close();
  });
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('llm: all ' + checks + ' checks passed');
  process.exit(0);
}
run().catch(function (e) { releaseLogs(); console.error('llm test crashed: ' + (e && e.stack || e)); process.exit(1); });
