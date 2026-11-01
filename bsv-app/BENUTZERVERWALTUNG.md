# Benutzerverwaltung - Version 0.2.0

## Versionsstand und Rollout

Die vorherige produktive Version ist auf GitHub durch den annotierten Tag
`v0.1.0-before-member-management-20261025` gesichert (Commit `fccc9e6`).
Version 0.2.0 ist lokal vorbereitet. Sie wird nicht automatisch durch diese
Bearbeitung auf GitHub oder Vercel veroeffentlicht. Bestehende, fremde vorgemerkte
Dateien im uebergeordneten Workspace gehoeren nicht zu diesem Release.

Keine produktive Migration und kein Versand echter Einladungen wurden hier
ausgefuehrt. Vor dem Rollout Datenbank-Backup erstellen und Migration 008 in
einer Supabase-Testumgebung pruefen. Sie erwartet die Migrationen 001 bis 007.
Migration und App zusammen in einem kurzen Wartungsfenster umstellen: Die alte
App kann nach Migration 008 keine Mitarbeiter mehr ueber die alten RPCs bearbeiten.
Ein reines Zuruecksetzen des App-Codes macht die Datenbankmigration nicht rueckgaengig.

## Datenmodell und Rechte

Es gibt absichtlich keine zweite Profiltabelle. `public.members` bleibt die
zentrale Mitarbeiter-/Benutzertabelle. Die bestehende Mitglieds-ID bleibt fuer
Dienstzuweisungen erhalten; `user_id` ist eindeutig mit `auth.users.id` verknuepft.
Neue Einladungen verknuepfen Profil und Auth-Konto durch einen Datenbanktrigger.
Altbestaende ohne Login oder E-Mail bleiben als unvollstaendig erhalten.

`account_status` ist eingeladen/aktiv/deaktiviert und unabhaengig von den
bestehenden Winter-/Sommerfeldern und dem saisonalen `status`. Die Rolle ist
admin/mitarbeiter und stammt ausschliesslich aus der Datenbank, nie aus
`user_metadata`. Die alte Dienstplan-Ansicht verwendet intern weiterhin das
kompatible Actor-Label `member`, nicht als eigene Berechtigungsquelle.

Mitarbeiter duerfen per RLS nur ihr eigenes Profil lesen und nur Vor-/Nachname
aendern. Der Dienstplan enthaelt weiterhin die fuer Zuweisungen erforderlichen
Namen anderer Mitglieder, aber keine fremden Kontaktdaten oder Auth-Verknuepfungen.
Admins haben Lesezugriff auf alle aktuellen Profile. Kontoverwaltung laeuft nur
ueber serverseitig gepruefte Endpunkte; alte Mitarbeiter-Schreib-RPCs sind gesperrt.
Next.js 16 verwendet `src/proxy.ts` statt der frueheren Middleware-Konvention.
Seite, Proxy, Route Handler und Datenbank pruefen die Zugriffsrechte zusaetzlich.

Deaktivieren sperrt Auth, entfernt Auth-Sessions und setzt eine Zeitgrenze fuer
alte Zugriffstokens. Wiederfreigabe verlangt eine neue Anmeldung. Noch nicht
angenommene Konten werden nur wieder eingeladen, nicht vorzeitig aktiviert.
Der letzte aktive Admin bleibt durch Datenbanktrigger geschuetzt. Selbstloeschung
und Selbstdeaktivierung sind verboten. Beim endgueltigen Loeschen wird das
Auth-Konto geloescht; zukuenftige Zuweisungen entfallen. Ein archivierter
Datensatz ohne Login/E-Mail behaelt den Namen fuer vergangene Dienste.

## Manuell in Supabase

1. Backup erstellen; doppelte E-Mail-Adressen im Altbestand bereinigen.
   Migration 008 bricht bei Duplikaten ab, statt Datensaetze still zu entfernen.
2. `supabase/migrations/008_account_management.sql` nach 001 bis 007 anwenden.
   SQL nicht wiederholt ausfuehren; Migrationen ueber ihren Versionsstand verwalten.
3. Auth > Providers > Email: E-Mail-Anmeldung aktivieren und neue oeffentliche
   Registrierungen deaktivieren. In der App gibt es keine Selbstregistrierung.
4. Auth > URL Configuration: Site URL auf `https://bsv-dienstplanung.vercel.app`
   setzen. Redirect URLs ergaenzen:
   `https://bsv-dienstplanung.vercel.app/auth/passwort-setzen` und
   `https://bsv-dienstplanung.vercel.app/auth/callback`.
   Lokale Entsprechungen nur fuer benoetigte Entwicklungsports erlauben.
5. Eigenes SMTP mit verifiziertem Absender konfigurieren und reale Zustellung
   pruefen. Supabase-Standard-SMTP ist fuer breite Mitgliederimporte ungeeignet
   und hat enge Empfaenger-/Versandlimits. Keine SMTP-Zugangsdaten ins Repository.
6. Unter Auth > Email Templates die Invite- und Recovery-Vorlagen aktualisieren.
   Als Linkziel mit einer festen, eigenen HTTPS-Domain verwenden:

   Einladung:
   `https://bsv-dienstplanung.vercel.app/auth/passwort-setzen?token_hash={{ .TokenHash }}&type=invite`

   Passwort-Reset und erneute Einrichtung bestehender Konten:
   `https://bsv-dienstplanung.vercel.app/auth/passwort-setzen?token_hash={{ .TokenHash }}&type=recovery`

   Token-Hash-Links funktionieren auch dann, wenn die Mail in einem anderen
   Browser als die urspruengliche Anfrage geoeffnet wird. Die Seite unterstuetzt
   ausserdem PKCE-Codes und aeltere implizite Auth-Links. Supabase bestaetigt den
   Link, der Mitarbeiter setzt sein Passwort selbst, erst dann wird er aktiv.

## Manuell in Vercel und lokal

Projekt: `bergsportverein-weitnau/bsv-dienstplanung`, Root Directory `bsv-app`,
Production Branch `main`. Die GitHub-Anbindung an
`2alexandernowikow2-gif/BSV` bleibt bestehen.

In Vercel die folgenden Variablen fuer **Production** setzen:

| Variable | Wert / Bedeutung |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Projekt-URL aus Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Oeffentlicher Anon-Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Geheimer serverseitiger Service-Role-Key |
| `APP_URL` | `https://bsv-dienstplanung.vercel.app` |
| `ADMIN_EMAIL` | `2alexander.nowikow2@gmail.com` |
| `BOOTSTRAP_SECRET` | Kryptografisch zufaelliges Secret, mindestens 32 Zeichen |
| `BOOTSTRAP_REPAIR_EXISTING_ADMIN` | Fuer die ausdruecklich gewuenschte Erst-Admin-Reparatur einmalig `true`, danach `false` |

`BOOTSTRAP_SECRET` und Service-Role-Key nicht als NEXT_PUBLIC, nicht in Logs und
nicht in GitHub-Variablen ablegen. Preview-Deployments erhalten kein produktives
Bootstrap-Secret. `VERCEL_ENV` kommt automatisch von Vercel; der Bootstrap lehnt
Aufrufe ausserhalb von Production ab, auch mit korrektem Secret.

Lokal `.env.local` anhand `.env.example` ergaenzen; Keys bleiben lokal und ignoriert.
`APP_URL` auf den eigenen lokalen Port setzen. Bootstrap wird lokal nicht gestartet.
Fuer die Verwaltung gegen eine lokale oder eigene Supabase-Testinstanz zuerst
deren Migrationen anwenden. Keine produktiven Secrets fuer die Browser-Fixture.

## Manuell in GitHub

1. Unter Settings > Secrets and variables > Actions ein Repository-Secret
   `BOOTSTRAP_SECRET` mit genau demselben Wert wie in Vercel eintragen.
2. Unter Actions-Variablen `PRODUCTION_APP_URL` auf
   `https://bsv-dienstplanung.vercel.app` setzen.
3. GitHub Actions fuer das Repository aktivieren und Vercel fuer `BSV`
   mit dem Repository verknuepfen. Der Bootstrap-Workflow startet absichtlich
   nur manuell und nicht durch normale Deployment-Statusmeldungen.
4. Erst nach Migration und Variablenkonfiguration die App-Aenderungen sowie
   `.github/workflows/bootstrap-admin.yml` gezielt committen und auf `main` pushen.
   Nicht blind alle bereits vorgemerkten Workspace-Dateien committen:
   darunter sind andere Projekte und persoenliche Kontaktdateien.
5. Nach dem erfolgreichen Vercel-Production-Deployment den Workflow
   `Bootstrap production administrator` nur dann ueber `Run workflow` auf `main`
   starten, wenn die einmalige Ersteinrichtung ausdruecklich noch aussteht.
   Nach erfolgreicher Anmeldung den Workflow nicht erneut starten.

Die Action verwendet eine fest konfigurierte Production-Domain, nicht eine URL
aus dem Ereignis, und ruft `POST /api/bootstrap-admin` mit dem Secret-Header auf.
Ein Datenbank-Lock und eine dauerhafte, eindeutige Versandreservierung verhindern
mehrfache Einrichtungsanforderungen auch bei parallelen Deployments.

Im Normalfall passiert bei vorhandenem Admin nichts. Der opt-in Reparaturmodus
sendet fuer die festgelegte bestehende Admin-Adresse einmal einen Passwort-Reset,
statt einen zweiten Auth-Benutzer anzulegen. Auch dieser Modus ist dauerhaft
idempotent. Nach erfolgreicher Einrichtung Reparaturvariable deaktivieren.

Ein Mailanbieter kann keine garantierte Genau-einmal-Zustellung liefern. Bei
unklarem Versandfehler reserviert das System den Versuch trotzdem dauerhaft.
Normale Deployments starten den Bootstrap-Workflow nicht. Zuerst SMTP-/Providerstatus
pruefen; nur wenn nachweislich kein Link versendet wurde, im Supabase-Notfallzugang
die betroffene Zeile in `bsv_private.bootstrap_requests` kontrolliert zuruecksetzen
und den Workflow einmal manuell wiederholen. Sobald ein Admin Zugang hat, laufen
Einladungen und Passwort-Resets ausschliesslich ueber die App.

## CSV und Abnahme

CSV-Spalten: `vorname;nachname;email;rolle`. `rolle` ist optional, Standard
`mitarbeiter`. Fuer den ersten Mitgliederimport alle Zeilen als Mitarbeiter
einladen; Adminrollen danach gezielt zuordnen. UTF-8 mit/ohne BOM und Komma oder
Semikolon werden unterstuetzt. Maximal 1 MB und 1000 Zeilen pro Datei.

Vorschau und serverseitige Neuvalidierung melden fehlende/ungueltige Adressen,
Dateiduplikate und vorhandene Konten. Existierende unverknuepfte Altmitglieder
werden anhand ihrer eindeutigen E-Mail verknuepft, nicht doppelt angelegt.
Der Browser sendet Batches mit maximal drei Zeilen; Server und Browser pausieren
zwischen Sendungen. Bereits angeforderte Einladungen werden nicht automatisch
erneut versendet. Fehlerhafte Einladungen lassen sich im UI gezielt erneut senden.
Ein Bericht pro Zeile kann als Excel-kompatible CSV heruntergeladen werden.

Automatisch pruefen: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`.
Die neuen SQL-Tests fuehren alle Migrationen in PGlite/PostgreSQL aus; Auth und
Mailanbieter werden dabei nicht gegen Production angesprochen. Die aeltere
manuelle Datei `tests/database.sql` dokumentiert den vorherigen RPC-Vertrag bis
Migration 007; fuer den neuen Kontovertrag sind `accounts-database.test.ts` und
die HTTP-/Regeltests massgeblich.

Isolierte visuelle Pruefung: `node tests/browser-fixture.mjs`, dann
`http://127.0.0.1:3012`; fiktiver Admin `admin@example.invalid`, beliebiges
nichtleeres Testpasswort. Die Fixture kopiert nur Quellcode/Konfiguration in ein
temporaeres Verzeichnis, niemals `.env.local`, und versendet keine echten Mails.

Vor Produktionsfreigabe manuell testen: Erst-Admin-Mail erhalten, Passwort setzen,
Adminliste oeffnen, eine reale Testeinladung annehmen, Reset-Link pruefen,
Mitarbeiterzugriff auf Adminseite/-API abweisen, deaktivierten Zugang auch mit
alter Session pruefen, einen kleinen CSV-Testimport wiederholen. Browser-Tests mit
fiktivem SMTP ersetzen diese echte Zustellungsabnahme nicht.