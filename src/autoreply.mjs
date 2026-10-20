// Automat YouTube dla kanałów AI GOATS (PL i EN). Uruchamiany co ~15 min przez GitHub Actions, osobno dla każdego kanału.
// 1. Odpowiada na komentarze ze słowem-kluczem z CTA (reguly.json — PL, reguly-en.json — EN).
// 2. Dodaje pierwszy komentarz pod nowym filmem (kolejka pierwsze-komentarze.json, dopisuje ją yt.mjs --komentarz),
//    gdy film stanie się publiczny — planowane filmy są prywatne aż do godziny publikacji.
// Bezstanowy: zanim cokolwiek napisze, sprawdza, czy kanał już to zrobił — nigdy nie pisze dwa razy.
//
// Zmienne środowiskowe: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (sekrety repo; dla EN token kanału EN),
// KANAL=pl|en (domyślnie pl), DRY_RUN=1 — tylko wypisuje, co by zrobił, nic nie publikuje.
import { readFile } from "node:fs/promises";

const API = "https://www.googleapis.com/youtube/v3";
const DRY = process.env.DRY_RUN === "1";
const KANAL = process.env.KANAL || "pl";
const MAX_AGE_DAYS = 14; // starszych komentarzy nie ruszamy
const MAX_REPLIES_PER_RUN = 40; // bezpiecznik (limit API ~190 odpowiedzi/dobę)
const FIRST_COMMENT_MAX_DAYS = 30; // wpisy kolejki starsze niż 30 dni pomijamy

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
const readJson = async (f) => JSON.parse(await readFile(new URL(`../${f}`, import.meta.url), "utf8"));

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
      refresh_token: process.env.YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Brak tokenu dostępu: " + JSON.stringify(j));
  return j.access_token;
}

async function yt(token, path, params = {}, init = {}) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j.error?.message || j)}`);
  return j;
}

// Reguła pasuje, gdy komentarz zawiera słowo-klucz jako osobne słowo (bez względu na wielkość liter i polskie znaki).
// Bezpiecznik: tylko krótkie komentarze (do MAX_WORDS słów) — „GOOGLE” w zwykłym zdaniu nie uruchamia automatu.
// Reguła z "aktywna": false czeka na akceptację tekstu / link docelowy — pomijana.
const MAX_WORDS = 4;
function matchRule(rules, videoId, text) {
  const words = norm(text).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return null;
  const t = ` ${words.join(" ")} `;
  return rules.find((r) => r.aktywna !== false && (!r.videoIds?.length || r.videoIds.includes(videoId)) && r.keywords.some((k) => t.includes(` ${norm(k)} `)));
}

async function replies(token, me, rules) {
  const since = Date.now() - MAX_AGE_DAYS * 864e5;
  let pageToken, stop = false, replied = 0, checked = 0;
  do {
    const page = await yt(token, "commentThreads", { part: "snippet,replies", allThreadsRelatedToChannelId: me.id, order: "time", maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    for (const th of page.items || []) {
      const top = th.snippet.topLevelComment.snippet;
      if (Date.parse(top.publishedAt) < since) { stop = true; break; }
      checked++;
      if (top.authorChannelId?.value === me.id) continue; // własne komentarze
      const rule = matchRule(rules, th.snippet.videoId, top.textOriginal || top.textDisplay);
      if (!rule) continue;

      // Czy już odpowiedzieliśmy? Odpowiedzi w wątku bywają niekompletne — wtedy dociągamy pełną listę.
      let rs = th.replies?.comments || [];
      if ((th.snippet.totalReplyCount || 0) > rs.length) {
        rs = (await yt(token, "comments", { part: "snippet", parentId: th.id, maxResults: "100" })).items || [];
      }
      if (rs.some((c) => c.snippet.authorChannelId?.value === me.id)) continue;

      // Bez nazwy autora i treści komentarza: logi repo są publiczne, a polityka prywatności
      // obiecuje, że cudzych komentarzy nie przechowujemy (YouTube Developer Policies III.E.4.d).
      console.log(`→ [${rule.nazwa}] wątek ${th.id} (film ${th.snippet.videoId})`);
      if (!DRY) {
        await yt(token, "comments", { part: "snippet" }, { method: "POST", body: JSON.stringify({ snippet: { parentId: th.id, textOriginal: rule.odpowiedz } }) });
      }
      if (++replied >= MAX_REPLIES_PER_RUN) { console.log("Osiągnięto limit odpowiedzi na jedno uruchomienie."); stop = true; break; }
    }
    pageToken = page.nextPageToken;
  } while (pageToken && !stop);
  console.log(`Odpowiedzi — sprawdzono wątków: ${checked}, ${DRY ? "do odpowiedzi" : "odpowiedziano"}: ${replied}.`);
}

// Pierwszy komentarz: wpis { kanal, videoId, tekst, dodano } z kolejki, gdy film jest już publiczny
// i kanał nie ma jeszcze pod nim własnego komentarza (sprawdzamy wątki filmu — stąd brak podwójnych wpisów).
async function firstComments(token, me) {
  const queue = (await readJson("pierwsze-komentarze.json")).filter((q) => q.kanal === KANAL
    && Date.now() - Date.parse(q.dodano) < FIRST_COMMENT_MAX_DAYS * 864e5);
  let added = 0;
  for (const q of queue) {
    const v = (await yt(token, "videos", { part: "status", id: q.videoId })).items?.[0];
    if (!v) { console.log(`Pierwszy komentarz: film ${q.videoId} nie istnieje (pominięty).`); continue; }
    if (v.status.privacyStatus !== "public") continue; // jeszcze zaplanowany
    const threads = (await yt(token, "commentThreads", { part: "snippet", videoId: q.videoId, maxResults: "100", order: "time" })).items || [];
    if (threads.some((t) => t.snippet.topLevelComment.snippet.authorChannelId?.value === me.id)) continue; // już jest
    console.log(`→ pierwszy komentarz pod filmem ${q.videoId}`);
    if (!DRY) {
      await yt(token, "commentThreads", { part: "snippet" }, { method: "POST", body: JSON.stringify({ snippet: { videoId: q.videoId, topLevelComment: { snippet: { textOriginal: q.tekst } } } }) });
    }
    added++;
  }
  console.log(`Pierwsze komentarze — w kolejce: ${queue.length}, ${DRY ? "do dodania" : "dodano"}: ${added}.`);
}

async function main() {
  const rules = await readJson(KANAL === "en" ? "reguly-en.json" : "reguly.json");
  const token = await accessToken();
  const me = (await yt(token, "channels", { part: "id,snippet", mine: "true" })).items?.[0];
  if (!me) throw new Error("Token nie jest powiązany z żadnym kanałem YouTube.");
  console.log(`Kanał: ${me.snippet.title} (${me.id}, ${KANAL})${DRY ? " — TRYB PRÓBNY" : ""}`);
  let failed = false;
  for (const step of [() => replies(token, me, rules), () => firstComments(token, me)]) {
    try { await step(); } catch (e) { console.error(e.message); failed = true; }
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
