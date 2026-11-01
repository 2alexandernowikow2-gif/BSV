# TODOs vor dem Deployment - Version 0.2.0

Stand: 25.10.2026. Die neue Benutzerverwaltung ist lokal vorbereitet, aber noch
nicht produktiv deployed. Migration 008 und echter Mailversand wurden nicht
gegen das produktive Supabase-Projekt ausgefuehrt. Die folgenden Punkte sind
noch manuell zu erledigen beziehungsweise auf ihre bestehende Einrichtung zu pruefen.

Die App wird auf Vercel bereitgestellt; in Supabase werden Datenbank, Auth und
Mailversand eingerichtet. Bereits korrekt eingestellte Werte nicht erneut aendern.
Zugangsdaten ausschliesslich direkt bei den jeweiligen Diensten eingeben,
niemals im Chat, in dieser Datei oder im Repository speichern.

## Reihenfolge

1. Supabase-Konfiguration und Datenbestand vorbereiten.
2. Vercel-Variablen und GitHub Action vorbereiten, ohne ein Deployment auszulooesen.
3. Im Wartungsfenster Migration 008 anwenden.
4. Direkt danach die vorbereitete Version gezielt pushen und deployen.
5. Erst-Admin-Einrichtung und echte Mailzustellung abnehmen.

**Migration 008 nicht vorzeitig auf Production ausfuehren:** Sie sperrt alte
Mitarbeiter-Schreibschnittstellen. Die bisherige App und die neue Datenbank
passen danach nicht mehr vollstaendig zusammen. Ein Code-Rollback allein
macht die Datenbankmigration nicht rueckgaengig.

## 1. Supabase: Projekt, Backup und Datenbestand

- [ ] Im [Supabase-Dashboard](https://supabase.com/dashboard) das bestehende
  produktive Projekt der BSV-App auswaehlen.
- [ ] Ein wiederherstellbares Backup einschliesslich Auth-Daten erstellen und
  den Wiederherstellungsweg pruefen. Verfuegbare Backup-Funktionen sind tarifabhaengig.
- [ ] Pruefen, dass Migrationen 001 bis 007 bereits vollstaendig angewendet sind.
  Alte Migrationen nicht vorsorglich erneut ausfuehren.
- [ ] Migration 008 zuerst in einer separaten Supabase-Testumgebung pruefen.
- [ ] Bestehende Mitglieder und den bisherigen Admin-Zugang erhalten;
  keine Tabellen oder Auth-Benutzer fuer die Neueinrichtung loeschen.
- [ ] Im SQL Editor folgende reine Pruefabfrage ausfuehren:

```sql
select lower(btrim(email)) as email, count(*) as anzahl
from public.members
where email is not null
group by lower(btrim(email))
having count(*) > 1;
```

- [ ] Bei Ergebniszeilen die betroffenen E-Mail-Adressen und Auth-Zuordnungen
  kontrolliert bereinigen. Keine Mitglieder mit Diensten einfach loeschen.
  Erwartetes Ergebnis vor der Migration: keine doppelten E-Mail-Adressen.
  Altmitglieder ohne E-Mail oder Login duerfen als unvollstaendig erhalten bleiben.

## 2. Supabase: E-Mail-Anmeldung

Unter Authentication > Providers > Email beziehungsweise den entsprechenden
Auth-Einstellungen; die Menuebezeichnungen koennen abweichen:

- [ ] E-Mail-Anmeldung aktivieren beziehungsweise vorhandene Aktivierung pruefen.
- [ ] Oeffentliche Selbstregistrierung deaktivieren.
- [ ] E-Mail-Bestaetigung aktiviert lassen.

Neue Mitarbeiter werden spaeter ausschliesslich durch Admins in der App eingeladen.

## 3. Supabase: SMTP-Versand

Unter Authentication > Email/SMTP Settings:

- [ ] Geeigneten Mailanbieter mit SMTP-Zugang bereitstellen. Eine reine
  Empfaengeradresse bei Gmail ersetzt keinen konfigurierten SMTP-Absender.
- [ ] Absenderadresse beziehungsweise Absenderdomain beim Mailanbieter verifizieren.
- [ ] SMTP-Host, Port, Benutzername und Passwort direkt in Supabase eintragen.
- [ ] Verifizierte Absenderadresse und Absendername, etwa BSV Weitnau, hinterlegen.
- [ ] Versandlimits und Providerkonfiguration pruefen; der Supabase-Standardversand
  ist fuer Mitgliederimporte wegen enger Limits und Empfaengerbeschraenkungen ungeeignet.
- [ ] SMTP-Verbindung beziehungsweise Testversand pruefen, soweit vom Anbieter
  unterstuetzt. Die echte Einladung samt App-Link erst nach dem Deployment abnehmen.

## 4. Supabase: Site URL und Redirect URLs

Unter Authentication > URL Configuration:

- [ ] Site URL auf `https://bsv-dienstplanung.vercel.app` setzen beziehungsweise pruefen.
- [ ] Folgende Redirect URLs jeweils einzeln eintragen beziehungsweise pruefen:

```text
https://bsv-dienstplanung.vercel.app/auth/passwort-setzen
https://bsv-dienstplanung.vercel.app/auth/callback
```

- [ ] Weitere bestehende, benoetigte Redirects erhalten. Lokale URLs nur fuer
  tatsaechlich verwendete Entwicklungsports freigeben; keine beliebigen Domains erlauben.

## 5. Supabase: E-Mail-Vorlagen

Unter Authentication > Email Templates:

- [ ] Die Vorlage Invite user bearbeiten, folgendes Linkziel verwenden und speichern:

```html
<h2>Einladung zur BSV-Dienstplanung</h2>
<p><a href="https://bsv-dienstplanung.vercel.app/auth/passwort-setzen?token_hash={{ .TokenHash }}&type=invite">Zugang einrichten und Passwort setzen</a></p>
```

- [ ] Die Vorlage Reset password bearbeiten, folgendes Linkziel verwenden und speichern:

```html
<h2>Passwort fuer die BSV-Dienstplanung setzen</h2>
<p><a href="https://bsv-dienstplanung.vercel.app/auth/passwort-setzen?token_hash={{ .TokenHash }}&type=recovery">Neues Passwort setzen</a></p>
```

- [ ] Supabase-Platzhalter unveraendert belassen. Die Reset-Vorlage wird auch fuer
  die einmalige Reparatur des bestehenden Erst-Admin-Zugangs verwendet.
- [ ] Noch keine echte Einrichtungsmail ausloesen: Die neue Passwort-Seite ist
  erst mit Version 0.2.0 produktiv verfuegbar.

## 6. Vercel: Projekt und Umgebungsvariablen

Projekt: `bergsportverein-weitnau/bsv-dienstplanung`.

- [ ] GitHub-Verbindung zu `2alexandernowikow2-gif/BSV` pruefen.
- [ ] Root Directory `bsv-app` und Production Branch `main` pruefen.
- [ ] Unter Settings > Environment Variables folgende Werte fuer Production setzen
  beziehungsweise vorhandene Werte pruefen:

| Variable | Erforderlicher Wert |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL des richtigen Supabase-Projekts |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Oeffentlicher Anon-Key desselben Projekts |
| `SUPABASE_SERVICE_ROLE_KEY` | Geheimer Service-Role-Key desselben Projekts; ausschliesslich serverseitig |
| `APP_URL` | `https://bsv-dienstplanung.vercel.app` |
| `ADMIN_EMAIL` | `2alexander.nowikow2@gmail.com` |
| `BOOTSTRAP_SECRET` | Neu erzeugtes kryptografisch zufaelliges Secret mit mindestens 32 Zeichen |
| `BOOTSTRAP_REPAIR_EXISTING_ADMIN` | `true` fuer die einmalige Reparatur des bisherigen Erst-Admins |

- [ ] Fuer `BOOTSTRAP_SECRET` denselben Wert spaeter als GitHub Actions Secret verwenden.
- [ ] Produktives Bootstrap-Secret nicht fuer Preview freigeben. Service-Role-Key
  und Bootstrap-Secret niemals mit `NEXT_PUBLIC_` benennen.
- [ ] `VERCEL_ENV` nicht selbst setzen: Vercel stellt den Production-Status bereit.
- [ ] Noch kein Redeployment starten, solange Migration und GitHub-Einrichtung fehlen.

## 7. GitHub: Bootstrap-Trigger vorbereiten

Im Repository `2alexandernowikow2-gif/BSV`:

- [ ] Unter Settings > Secrets and variables > Actions > Secrets ein
  Repository-Secret `BOOTSTRAP_SECRET` mit genau demselben Wert wie in Vercel anlegen.
- [ ] Unter Actions > Variables die Repository-Variable `PRODUCTION_APP_URL`
  mit `https://bsv-dienstplanung.vercel.app` anlegen.
- [ ] GitHub Actions fuer das Repository aktivieren beziehungsweise Freigaben pruefen.
- [ ] Vercel-GitHub-Integration und Production-Deployment-Statusmeldungen pruefen.
- [ ] Den vorbereiteten Workflow
  [bootstrap-admin.yml](../.github/workflows/bootstrap-admin.yml) fuer das Release vormerken.
  Er muss im Repository-Root unter `.github/workflows/` liegen, nicht im App-Unterordner.

## 8. Release und Wartungsfenster vorbereiten

- [ ] Pruefen, dass die Sicherungsversion
  `v0.1.0-before-member-management-20261025` auf GitHub vorhanden ist.
- [ ] Wartungsfenster und Wiederherstellungsplan fuer Datenbank und App abstimmen.
- [ ] Den aktuellen Release-Stand aus dem App-Ordner pruefen:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

- [ ] Nur die vorgesehenen App-Aenderungen, Migration, Dokumentation und den
  GitHub-Workflow fuer den Commit auswaehlen. Kein pauschales Commit aller
  vorgemerkten Workspace-Dateien: Darunter sind andere Projekte, Kontaktdateien
  und Screenshots. Keine echten `.env`-Dateien, Zugangsdaten oder Kontaktlisten hochladen.
- [ ] Sicherstellen, dass Supabase-, Vercel- und GitHub-Einstellungen aus den
  Abschnitten 1 bis 7 bereit sind. Vorher nicht auf `main` pushen.

## 9. Unmittelbar vor dem Deployment: Migration anwenden

- [ ] Noch einmal richtiges Projekt, aktuelles Backup und Wartungsfenster pruefen.
- [ ] [008_account_management.sql](supabase/migrations/008_account_management.sql)
  vollstaendig und einmalig anwenden. Bei Dashboard-Verwaltung: SQL Editor > New query,
  gesamten Dateiinhalt einfuegen und ausfuehren. Bei bestehender CLI-Migrationsverwaltung
  stattdessen deren regulaeren Ablauf nutzen; die beiden Wege nicht vermischen.
- [ ] Bei Fehlern stoppen und Ursache pruefen. Nicht einzelne SQL-Bloecke
  ueberspringen oder die Migration ungeprueft erneut starten.
- [ ] Erfolgreiche Anwendung dokumentieren und in `public.members` die neuen
  Felder `vorname`, `nachname`, `account_status` und `archived_at` pruefen.

Die Migration verschickt keine Mail. Direkt danach muss die passende App-Version
bereitgestellt werden; die alte Mitarbeiterverwaltung ist nicht mehr voll kompatibel.

## 10. Deployment und anschliessende Abnahme

Diese Punkte sind absichtlich getrennt: Sie koennen erst nach Abschluss aller
Vorbereitungen beziehungsweise nach dem Deployment abgehakt werden.

- [ ] Die gezielt ausgewaehlten Release-Dateien committen und auf `main` pushen.
  Das startet das Vercel-Production-Deployment.
- [ ] In Vercel den Status Ready fuer den neuen Commit und die Produktionsdomain pruefen.
- [ ] Nach erfolgreichem Production-Deployment den Workflow Bootstrap production
  administrator nur einmal manuell ueber Run workflow auf `main` starten.
  Normale Deployments starten diesen Workflow nicht.
- [ ] Einrichtungsmail an `2alexander.nowikow2@gmail.com` empfangen und Link oeffnen.
  Beim vorhandenen Konto ist das ein Reset-Link, kein zweites Benutzerkonto.
- [ ] Eigenes Passwort mit mindestens sechs Zeichen setzen und identisch bestaetigen.
- [ ] Weiterleitung zu `/admin/mitarbeiter` und spaetere regulaere Anmeldung pruefen.
- [ ] `BOOTSTRAP_REPAIR_EXISTING_ADMIN` in Vercel auf `false` setzen; die Aenderung
  wird mit dem naechsten Deployment wirksam. Die dauerhafte Versandreservierung
  verhindert weitere Einrichtungsmails auch schon vorher.
- [ ] Eine reale Testeinladung, Passwort-Reset, Mitarbeiter-Zugriffssperre auf Adminseiten,
  Kontodeaktivierung mit alter Session und einen kleinen wiederholten CSV-Import pruefen.
- [ ] Bei Versandfehlern zuerst SMTP-/Providerstatus pruefen. Kein blindes
  Wiederholen von Deployments und keine unkontrollierte Loeschung von Bootstrap-Sperren.

## Weiterfuehrende Anleitungen

- [Admin-Erstanmeldung in der README](README.md#erstanmeldung-als-admin)
- [Detaillierte Einrichtung und Notfallhinweise](BENUTZERVERWALTUNG.md)

Nach erfolgreicher Einrichtung laufen Mitarbeiteranlage, Rollenvergabe,
Einladungen, Kontosperren und Passwort-Resets im Normalbetrieb ueber die App.
Das Supabase-Dashboard bleibt der Notfallzugang.