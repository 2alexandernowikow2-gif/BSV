Vorschlag für den Monatsablauf

Monat vorbereiten: Admin erzeugt die Dienste als Entwürfe, passt Zeiten gesammelt an und prüft Konflikte sowie Aufgaben.
Anmeldung öffnen: Admin veröffentlicht den Plan zur Anmeldung. Mitglieder sehen offene Aufgaben im Kalender und tragen sich selbst ein.
Monat ausgleichen: Eine Übersicht zeigt pro Mitglied die Zahl der übernommenen Dienste und welche Aufgaben noch offen sind. So sieht der Admin schnell, wer noch gar nicht oder schon besonders oft eingeteilt ist.
Rest verteilen: Nach einer Frist schlägt die App passende Zuweisungen für die verbleibenden Aufgaben vor, unter Beachtung von Verfügbarkeit, Qualifikationen und Zeitkonflikten. Der Admin bestätigt oder ändert die Vorschläge.
Plan abschließen: Der Admin schließt die Anmeldung und markiert den Monat als endgültig. Änderungen danach sollten nachvollziehbar sein und betroffene Mitglieder informieren.


Nächste Schritte: 
Supabase einrichten: Projekt bereitstellen und die Datenbankmigrationen 001 bis 006 in Reihenfolge ausführen. Danach die Supabase-Zugangsdaten lokal konfigurieren und den Onlinebetrieb testen.

Importdatei fertig prüfen: Die CSV enthält 81 Mitglieder. Sechs E-Mail-Adressen haben interne Leerzeichen und müssen in der Quelle korrigiert werden; 19 Mitglieder haben keine E-Mail-Adresse. Außerdem ist ein als aktiv markierter Kontakt weder Winter noch Sommer zugeordnet. Diese Saisonzuordnung sollte vor dem Import geklärt werden.

Zusatzinfo entscheiden: Das aktuelle Mitgliederschema speichert keine Spalte „Zusatzinfo“. Diese Hinweise würden beim Import verloren gehen, sofern wir nicht vorher ein entsprechendes Datenbankfeld ergänzen. Die CSV enthält teils persönliche Einsatzhinweise; diese sollten nur übernommen werden, wenn sie für die Planung wirklich benötigt werden.

Einmalig importieren: CSV in eine vorübergehende Staging-Tabelle laden, die Datensätze kontrollieren und anschließend in members übernehmen. Saisonflags und Qualifikationen werden dabei direkt gemappt; die Datenbank erzeugt die internen IDs. Danach wird die Staging-Tabelle wieder gelöscht.

Adminrechte manuell vergeben: Die Lukify-Gruppe „Admins“ sollte nicht automatisch App-Administratorrechte erzeugen. Den ersten Admin-Zugang ordnet ihr gezielt über die Supabase-Auth-ID zu.


🌐 Lokal für den Smoke-Test vorbereiten
Zusätzlich wichtig:

Auth → URL Configuration:
Site URL: http://127.0.0.1:3008
Redirect URLs: http://127.0.0.1:3008/** und ggf. http://localhost:3008/**