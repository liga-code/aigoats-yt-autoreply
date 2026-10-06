// Automat odpowiedzi na komentarze ze słowem-kluczem pod filmami kanału AI GOATS.
// Uruchamiany co ~15 min przez GitHub Actions. Bezstanowy: zanim odpowie, sprawdza,
// czy kanał już odpisał w danym wątku — dzięki temu nigdy nie odpowiada dwa razy.
//
// Zmienne środowiskowe: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (sekrety repo),
// DRY_RUN=1 — tylko wypisuje, co by zrobił, nic nie publikuje.
import { readFile } from "node:fs/promises";

const API = "https://www.googleapis.com/youtube/v3";
const DRY = process.env.DRY_RUN === "1";
const MAX_AGE_DAYS = 14; // starszych komentarzy nie ruszamy
const MAX_REPLIES_PER_RUN = 40; // bezpiecznik (limit API ~190 odpowiedzi/dobę)

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

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
const MAX_WORDS = 4;
function matchRule(rules, videoId, text) {
  const words = norm(text).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return null;
  const t = ` ${words.join(" ")} `;
  return rules.find((r) => (!r.videoIds?.length || r.videoIds.includes(videoId)) && r.keywords.some((k) => t.includes(` ${norm(k)} `)));
}

async function main() {
  const rules = JSON.parse(await readFile(new URL("../reguly.json", import.meta.url), "utf8"));
  const token = await accessToken();
  const me = (await yt(token, "channels", { part: "id,snippet", mine: "true" })).items?.[0];
  if (!me) throw new Error("Token nie jest powiązany z żadnym kanałem YouTube.");
  console.log(`Kanał: ${me.snippet.title} (${me.id})${DRY ? " — TRYB PRÓBNY" : ""}`);

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
      let replies = th.replies?.comments || [];
      if ((th.snippet.totalReplyCount || 0) > replies.length) {
        replies = (await yt(token, "comments", { part: "snippet", parentId: th.id, maxResults: "100" })).items || [];
      }
      if (replies.some((c) => c.snippet.authorChannelId?.value === me.id)) continue;

      console.log(`→ [${rule.nazwa}] ${top.authorDisplayName}: "${(top.textOriginal || "").slice(0, 80)}" (film ${th.snippet.videoId})`);
      if (!DRY) {
        await yt(token, "comments", { part: "snippet" }, { method: "POST", body: JSON.stringify({ snippet: { parentId: th.id, textOriginal: rule.odpowiedz } }) });
      }
      if (++replied >= MAX_REPLIES_PER_RUN) { console.log("Osiągnięto limit odpowiedzi na jedno uruchomienie."); stop = true; break; }
    }
    pageToken = page.nextPageToken;
  } while (pageToken && !stop);

  console.log(`Sprawdzono wątków: ${checked}, ${DRY ? "do odpowiedzi" : "odpowiedziano"}: ${replied}.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
