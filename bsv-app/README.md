# BSV Weitnau - Dienstplanung

Next.js/React-App mit Wochen- und Monatskalender, eigener Dienstsuche,
Mitarbeiterverwaltung und Adminplanung. Ohne Supabase-Konfiguration wird ein
ausdruecklich gekennzeichneter lokaler Demomodus mit fiktiven Personen verwendet.
Demo-Ruecktritte versenden keine E-Mails. Keine echten Kontaktdaten im Demomodus
speichern. Die endgueltigen Mitarbeiterfelder werden nach dem zweiten Upload
festgelegt.

## Version 0.2.0 - zentrale Benutzerverwaltung

Die neue Mitarbeiter-/Loginverwaltung ist lokal vorbereitet. Einrichtung,
Migration, einmalige Reparatur des bisherigen Erst-Admins und manuelle
Rollout-Schritte stehen in [BENUTZERVERWALTUNG.md](BENUTZERVERWALTUNG.md).
Vor Deployment zuerst Migration 008 und die dort beschriebenen Secrets einrichten.
Die vorherige produktive Version ist durch den Git-Tag
`v0.1.0-before-member-management-20261025` gesichert.

## Erstanmeldung als Admin

Dieser Ablauf ist fuer Version 0.2.0 vorbereitet, aber noch nicht produktiv
aktiviert. Zuerst Migration, Mailkonfiguration, Vercel-Variablen und GitHub
Action gemaess [BENUTZERVERWALTUNG.md](BENUTZERVERWALTUNG.md) einrichten.
Die Erst-Admin-Adresse ist `2alexander.nowikow2@gmail.com` (`ADMIN_EMAIL`).

1. **Erfolgreiches Production-Deployment:** Erst nach der erfolgreichen
   Veroeffentlichung auf Vercel ruft die GitHub Action den geschuetzten
   Bootstrap-Endpunkt auf. Ein fehlgeschlagenes Deployment loest keine Mail aus.
2. **Bestehenden Zugang einmalig reparieren:** Fuer die bisher nicht gelungene
   Erstanmeldung wird `BOOTSTRAP_REPAIR_EXISTING_ADMIN=true` gesetzt. Das
   bestehende Konto wird wiederverwendet und erhaelt einen Passwort-Setzen-/
   Reset-Link per E-Mail. Es wird kein zweites Benutzerkonto angelegt.
   Bei einer vollstaendigen Neueinrichtung ohne vorhandenes Konto wird
   stattdessen eine Einladung versendet.
3. **E-Mail-Link oeffnen:** Der Link fuehrt zu `/auth/passwort-setzen` und wird
   auf Gueltigkeit geprueft. Ein ungueltiger oder abgelaufener Link zeigt eine
   verstaendliche Fehlermeldung.
4. **Eigenes Passwort vergeben:** Ein Passwort mit mindestens zwoelf Zeichen
   eingeben und identisch wiederholen. Niemand aus der Vereinsverwaltung
   vergibt oder erhaelt dieses Passwort.
5. **Admin-Zugang nutzen:** Nach erfolgreichem Speichern wird ein noch
   eingeladener Zugang aktiviert. Die App leitet direkt zur Verwaltung unter
   `/admin/mitarbeiter` weiter. Dort lassen sich Mitarbeiter einladen,
   per CSV importieren und verwalten.
6. **Spaeter normal anmelden:** Unter https://bsv-dienstplanung.vercel.app mit
   der Erst-Admin-E-Mail und dem selbst gewaehlten Passwort anmelden. Nach
   erfolgreicher Einrichtung `BOOTSTRAP_REPAIR_EXISTING_ADMIN=false` setzen.

Weitere Deployments versenden keine erneute Einrichtungsmail. Eine dauerhafte
Versandreservierung verhindert Wiederholungen auch bei versehentlich weiterhin
aktiviertem Reparaturmodus. Ein vorhandenes Passwort wird durch den Versand der
Mail noch nicht geaendert, sondern erst beim Speichern des neuen Passworts.

Bei einem unklaren Versandfehler erfolgt bewusst kein automatischer Neuversand.
Zuerst den SMTP-/Providerstatus pruefen und eine Wiederholung nur kontrolliert
nach den Einrichtungshinweisen ausloesen. Die echte Mailzustellung muss nach
Einrichtung der produktiven Mailkonfiguration gesondert getestet werden.

## Oeffentlicher Zugriff

Die Anmeldemaske ist unter https://bsv-dienstplanung.vercel.app erreichbar.
Hosting: Vercel-Projekt `bsv-dienstplanung` im Team `bergsportverein-weitnau`.
Production-Umgebungsvariablen sind in Vercel hinterlegt; der Service-Role-Key
ist als Secret gespeichert. Supabase Site URL zeigt auf diese HTTPS-Adresse,
die Redirect-Allowlist enthaelt deren `/auth/callback`.

Das erste Deployment erfolgte per Dateiimport ohne lokale Schluessel und
Kontaktdateien. Fuer Codeaenderungen ist ein neuer bereinigter Upload oder
eine Git-Anbindung erforderlich; lokale Aenderungen werden nicht automatisch
veroeffentlicht. Version 0.2.0 verwendet `ADMIN_EMAIL` und einen geschuetzten
Deployment-Bootstrap. Das Passwort wird ueber den Einladungs-/Reset-Link selbst
vergeben. Dieser lokale Codeaenderungsstand ist noch nicht deployed.
E-Mailzustellung und Callback muessen nach dem Deployment mit der Hosted-
Supabase-Konfiguration abgenommen werden. Der Session-Endpunkt meldet
konfigurierten Onlinebetrieb,
unauthentifizierter Zugriff auf den Plan wird gesperrt.

## Lokal starten

Node.js >=22.14 installieren oder eine portable Laufzeit verwenden.

```powershell
npm.cmd install
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Standardadresse: http://127.0.0.1:3000. Wenn belegt: `npm.cmd run dev -- --port 3001`.
Die in dieser Sitzung gestartete Produktionsvorschau ist unter
http://127.0.0.1:3008 erreichbar (`npm.cmd start -- --port 3008`).
Im Demomodus kann zwischen Admin und fiktiven Mitgliedern gewechselt werden.
Dieser Rollenwechsel existiert nicht im konfigurierten Onlinebetrieb.

### Zugriff von anderen Geraeten

`127.0.0.1` und `localhost` sind nur auf dem Serverrechner erreichbar.
Fuer einen Test im selben vertrauenswuerdigen WLAN den Produktionsbuild mit
der LAN-Adresse des Serverrechners starten:

```powershell
$env:APP_URL = 'http://192.168.178.118:3009'
npm.cmd run start:lan -- --port 3009
```

Auf dem anderen Geraet `http://192.168.178.118:3009` oeffnen. Die IP-Adresse
kann sich aendern. Der Serverrechner muss eingeschaltet sein; WLAN-Isolation
und Windows-Firewall koennen den Zugriff sperren. Firewall-Freigaben nur nach
Freigabe durch den Netzwerkverantwortlichen und auf das private Netz begrenzt
einrichten. HTTP im LAN ist nur ein Testbetrieb, kein sicherer Dauerbetrieb.
Einladungen erfordern dieselbe erreichbare Site URL und Callback-Adresse in
Supabase Auth. Bereits verschickte localhost-Links werden nicht aktualisiert.

Fuer Zugriff ausserhalb dieses WLANs muss die Next.js-App separat auf einem
HTTPS-Host bereitgestellt werden. Supabase hostet hier nur Datenbank und Auth,
nicht die Next.js-Anmeldemaske. Dort die Supabase-Umgebungsvariablen serverseitig
setzen und `APP_URL`, Supabase Site URL und Redirect-Allowlist auf die
oeffentliche HTTPS-Adresse umstellen. Keine Router-Portfreigabe fuer diesen
lokalen HTTP-Testserver verwenden.

Bei npm-Netzwerkfehlern im Firmennetz ist eventuell der Windows-Proxy erforderlich.
Dieser kann ohne Ausgabe von Zugangsdaten fuer die aktuelle Konsole uebernommen werden:

```powershell
$target = [uri]'https://registry.npmjs.org'
$proxy = [System.Net.WebRequest]::DefaultWebProxy.GetProxy($target)
if ($proxy -ne $target) {
   $env:HTTPS_PROXY = $proxy.AbsoluteUri
   $env:HTTP_PROXY = $proxy.AbsoluteUri
}
```

## Supabase einrichten

1. Supabase-Projekt in einer EU-Region erstellen. Migrationen
   `supabase/migrations/001_schedule.sql`, danach
   `supabase/migrations/002_monthly_planning.sql` und
   `supabase/migrations/003_member_season_status.sql` sowie
   `supabase/migrations/004_member_dual_seasons.sql`,
   `supabase/migrations/005_qualification_review_hints.sql`,
   `supabase/migrations/006_standard_task_names.sql` und
   `supabase/migrations/007_first_admin_bootstrap.sql` ueber SQL Editor oder Supabase CLI anwenden.
2. `.env.local` anhand `.env.example` einrichten. Service-Role-Key bleibt nur
   auf dem Server; niemals als NEXT_PUBLIC-Variable speichern.
3. Supabase-E-Mail-Anmeldung und E-Mail-Bestaetigung aktivieren; oeffentliche
   Registrierung ausschalten. Migration 008 anwenden und `ADMIN_EMAIL` sowie
   den Production-Bootstrap gemaess Benutzerverwaltungs-Anleitung konfigurieren.
4. Site URL und Redirect Allowlist konfigurieren: lokal
   `http://127.0.0.1:3000/auth/callback`, spaeter die HTTPS-Produktionsadresse.
   `APP_URL` muss auf dieselbe erreichbare App-Adresse zeigen.
5. Invite- und Recovery-Mailtemplate auf `/auth/passwort-setzen` mit Token-Hash
   umstellen, wie in der Benutzerverwaltungs-Anleitung beschrieben. Auth SMTP
   mit verifiziertem Absender konfigurieren. Nach der Ersteinrichtung verwaltet
   der Admin Mitarbeiter und Einladungen unter `/admin/mitarbeiter`.
6. Admin speichert Benachrichtigungsempfaenger vor Veroeffentlichung von Diensten.
   Die Empfaengeradresse muss organisatorisch verifiziert werden.

## Ruecktrittsmails

Auth SMTP verschickt keine Anwendungsbenachrichtigungen. Hierfuer die Edge Function
`supabase/functions/send-notifications/index.ts` deployen. Secrets in Supabase
konfigurieren: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL` (HTTPS-Origin),
`CRON_SECRET` (zufaellig, mindestens 32 Zeichen). Supabase-URL und Service-Role
werden vom Funktionssystem bereitgestellt. Resend-Absenderdomain verifizieren.

Scheduler ruft die Funktion regelmaessig per POST mit Header `x-cron-secret` auf;
bei geheimer Header-Authentifizierung Function mit `--no-verify-jwt` deployen.
Keine Scheduler-Secrets im Browser oder Repository speichern.
Die Datenbank schreibt eine Ruecktrittsmeldung gemeinsam mit der Austragung.
Worker versendet mit Lease, Wiederholungen und Idempotenzschluessel. Mailfehler
machen Austragungen nicht rueckgaengig. Dauerhaft fehlgeschlagene Eintraege sind
operativ in `notification_outbox` durch privilegierte Administratoren zu pruefen.
Absolute Exactly-once-Zustellung durch externe Mailanbieter ist nicht garantiert.

## Planung

Freitag 18:00-22:00, Samstag/Sonntag 09:30-14:00 und 14:00-18:30.
Die Standardaufgaben heissen Betriebswart, Kasse und Bergstation. Freitagsaufgaben
muessen vor Erzeugung ausgewaehlt werden. Buegel/Liftaufsicht kann beim
Fruehdienst optional hinzugefuegt werden und hat ein zweistuendiges eigenes
Zeitfenster. Zusaetzliche Dienste sind
an jedem Wochentag moeglich. Einzel- und Sammelaenderungen erhalten Dienstdatei
und Aufgabenfenster; Konflikte verhindern atomar die ganze Aenderung.
Es werden keine Schichten ueber Mitternacht unterstuetzt.

Die drei Standardaufgaben verwenden jeweils die gleichnamige Qualifikation;
Mitglieder koennen Qualifikationen per Checkbox mehrfach erhalten. Fehlende
Qualifikation blockiert weder Selbsteintragung noch Adminzuweisung. Im
Planungsbereich erscheinen stattdessen gelbe, nicht verpflichtende Hinweise zur
Pruefung. Automatische Vorschlaege bevorzugen qualifizierte Mitglieder.

Die Admin-Planung fuehrt pro Monat die Phasen Entwurf, Anmeldung offen und
Abgeschlossen. Veroeffentlichen oeffnet die Anmeldung; der Abschluss ist erst
moeglich, wenn zukuenftige Dienste veroeffentlicht und besetzt sind. Ein
abgeschlossener Monat ist schreibgeschuetzt und kann vom Admin ausdruecklich
wieder geoeffnet werden. Die Monatsuebersicht zeigt Besetzungen pro aktivem
Mitglied und faire, einzeln bestaetigte Zuweisungsvorschlaege unter Beachtung
von Qualifikationen und Zeitkonflikten.

Mitglieder koennen unabhaengig fuer Winter und Sommer aktiviert werden. Sind
beide Saisons ausgewaehlt, werden sie in beiden Planungsverteilungen
beruecksichtigt; sind beide nicht ausgewaehlt, gelten sie als inaktiv. Alle
Mitglieder behalten Zugang und Selbsteintragung. Inaktive werden nur aus
Monatsbilanz und automatischen Zuweisungsvorschlaegen ausgeschlossen. Vorschlaege
beruecksichtigen Wintertermine vom 15. November bis einschliesslich 15. Maerz
und Sommertermine in der uebrigen Zeit. Migration 004 uebernimmt die bisherigen
Saisonstatus in die beiden Checkbox-Felder. Migration 006 aktualisiert alte
Aufgabennamen und Qualifikationen auf die Standardnamen.

## Pruefungen und Betriebsgrenzen

`tests/domain.test.ts` prueft lokale Dienstregeln; `tests/database.sql` prueft
PostgreSQL-Rollen und Transaktionen mit Test-Auth-Kontext. Nur in isolierter
Testdatenbank ausfuehren, nicht mit realen Vereinsdaten.
Zuletzt lokal geprueft: TypeScript-Pruefung, Produktionsbuild und 28
Domain-Regressionstests. SQL-Migrationen 005 und 006 sowie deren Verhalten gegen
Hosted Supabase muessen vor Onlinebetrieb noch in einer isolierten Datenbank
ausgefuehrt und geprueft werden. Browserpruefungen decken Desktop und Handy ab;
Qualifikationsabweichungen sind unverbindliche Admin-Hinweise, keine Sperre.

Hosted-Supabase-Integration, echte E-Mailzustellung und parallele Live-Sessions
sind weiterhin ungeprueft. Die Mailwarteschlange ist operativ ueber Supabase
zu ueberwachen; eine Adminansicht fuer Versandfehler fehlt noch. Mitarbeiterfelder
und Kontaktimport sind bis zum angekuendigten Upload vorlaeufig. Ein erneutes
Einladen bereits zugeordneter Zugaenge und Passwort-Recovery fehlen in dieser
ersten Version. Auch eine eigene Dienststornierung ist noch nicht implementiert.
Kein produktionsreifer Betrieb ohne diese Abnahme, HTTPS, Backup und Datenschutz-
pruefung. Keine automatische Zuordnung von Screenshot-Namen oder echten Kontakten.