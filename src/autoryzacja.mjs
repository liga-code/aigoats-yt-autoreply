// Jednorazowe logowanie: otwiera zgodę Google, odbiera kod na localhost i wypisuje YT_REFRESH_TOKEN.
// Użycie:  node src/autoryzacja.mjs <CLIENT_ID> <CLIENT_SECRET>
// W oknie Google wybierz konto / kanał AI GOATS (jeśli kanał to „konto marki” — wybierz właśnie je).
import { createServer } from "node:http";
import { exec } from "node:child_process";

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error("Użycie: node src/autoryzacja.mjs <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}
const PORT = 8765;
const redirect = `http://localhost:${PORT}`;
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/youtube.force-ssl",
  access_type: "offline",
  prompt: "consent",
});

createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.end("Brak kodu."); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  if (j.refresh_token) {
    res.end("Gotowe — możesz zamknąć to okno i wrócić do terminala.");
    console.log("\nYT_REFRESH_TOKEN=" + j.refresh_token + "\n");
  } else {
    res.end("Nie udało się: " + JSON.stringify(j));
    console.error(j);
  }
  process.exit(0);
}).listen(PORT, () => {
  console.log("Otwieram przeglądarkę ze zgodą Google…\nJeśli się nie otworzy, wklej ten adres:\n" + url);
  exec(`start "" "${url}"`);
});
