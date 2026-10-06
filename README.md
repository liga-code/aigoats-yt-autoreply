# Automat odpowiedzi na komentarze — YouTube AI GOATS

Gdy ktoś pod rolką AI GOATS napisze słowo z CTA (np. „PAMIĘĆ”), automat w ciągu ~15–30 minut
odpowiada mu w wątku gotowym tekstem z linkami. Bez serwera, bez opłat.

## Jak to działa

```
GitHub Actions (co 15 min) ──► node src/autoreply.mjs
        │
        ├─ 1. wymienia stały klucz (refresh token) na krótki token dostępu Google
        ├─ 2. pobiera najnowsze komentarze pod filmami kanału (YouTube Data API)
        ├─ 3. dla każdego krótkiego komentarza (do 4 słów) szuka słowa z reguly.json
        ├─ 4. sprawdza, czy kanał już odpisał w tym wątku — jeśli tak, pomija
        └─ 5. publikuje odpowiedź jako kanał AI GOATS
```

- **GitHub Actions** to darmowe „zadania cykliczne” GitHuba: o zadanej porze GitHub uruchamia
  na swoim komputerze nasz skrypt. Harmonogram jest w `.github/workflows/autoreply.yml`.
- **Nic nie zapisujemy** — automat za każdym razem sprawdza, czy już odpowiedział.
  Nie da się więc odpisać komuś dwa razy, nawet gdy coś się zatnie.
- YouTube **nie ma prywatnych wiadomości** — odpowiedź jest publiczna, w wątku komentarza.
- Komentarze starsze niż 14 dni są pomijane; maks. 40 odpowiedzi na jedno uruchomienie
  (dzienny darmowy limit API YouTube wystarcza na ok. 190 odpowiedzi).

## Nowa rolka = nowa reguła

Dopisz pozycję w `reguly.json`:

```json
{
  "nazwa": "Nazwa rolki",
  "keywords": ["słowo", "slowo"],
  "videoIds": [],
  "odpowiedz": "Cześć, dzięki za komentarz! 🙌 ...\n\n- https://... – opis\n\nZespół AI GOATS"
}
```

- `keywords` — wielkość liter i polskie znaki nie mają znaczenia („PAMIĘĆ” = „pamiec”).
- `videoIds` — puste = reguła działa pod każdym filmem. Gdy to samo słowo ma dawać różne
  odpowiedzi pod różnymi filmami, wpisz ID filmu (część adresu po `/shorts/`).

## Sekrety (GitHub → repo → Settings → Secrets and variables → Actions)

| Nazwa | Skąd |
|---|---|
| `YT_CLIENT_ID` | Google Cloud → APIs & Services → Credentials → OAuth client (Desktop app) |
| `YT_CLIENT_SECRET` | jw. |
| `YT_REFRESH_TOKEN` | wynik `node src/autoryzacja.mjs <CLIENT_ID> <CLIENT_SECRET>` |

**Ważne:** aplikacja OAuth w Google Cloud musi mieć status **„In production”**, nie „Testing” —
w trybie testowym Google unieważnia refresh token po 7 dniach i automat przestaje działać.
Ostrzeżenie „Google hasn't verified this app” przy logowaniu jest normalne (to nasza własna aplikacja).

## Ręczne uruchomienie / test

GitHub → zakładka **Actions** → „Odpowiedzi na komentarze YouTube” → **Run workflow**.
Domyślnie w trybie próbnym: tylko wypisuje w logu, komu by odpowiedział.

Lokalnie: `DRY_RUN=1 YT_CLIENT_ID=... YT_CLIENT_SECRET=... YT_REFRESH_TOKEN=... node src/autoreply.mjs`

## Gdy przestanie działać

- Czerwone przebiegi w zakładce Actions + błąd `invalid_grant` → refresh token wygasł lub został
  cofnięty (np. zmiana hasła konta Google). Uruchom ponownie `src/autoryzacja.mjs` i podmień sekret.
- GitHub wyłącza harmonogram w publicznym repo po 60 dniach bez zmian w repozytorium — workflow
  `keepalive.yml` raz w miesiącu robi drobny commit, żeby do tego nie doszło.
