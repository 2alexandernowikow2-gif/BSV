# Tagesverfuegbarkeit

Lokal vorbereitet. Vor dem Deployment Migration 013 nach 001 bis 012 einmalig
in Supabase anwenden. Die Migration fuegt Ausnahmen und geschuetzte RPCs hinzu;
vorhandene Dienste, Zuweisungen und Mitglieder werden nicht migriert.

Ohne Ausnahme gilt ein Diensttag als verfuegbar. Heutige Tage bleiben bis
Mitternacht in Europe/Berlin aenderbar. Tage ohne Dienste und ausschliesslich
abgesagte Tage werden nicht angeboten. Entwurfstage zeigen keine fremden
Entwurfszuweisungen. Tageszahlen umfassen nur saisonpassende aktivierte Konten.

RLS: Mitglieder lesen alle Ausnahmen, schreiben nur eigene; Admins schreiben
fuer aktivierte Mitglieder. Die separate Policy `availability_read` kann spaeter
auf `public.is_admin()` beschraenkt werden. Dann auch `load_availability` und
die Snapshot-Ausgabe auf dieselbe Leseregel umstellen, da RPCs Security Definer
verwenden. Namenslisten enthalten keine fremden Kontaktinformationen.

Vorschlaege beruecksichtigen Entwuerfe und freigegebene Dienste. Es wird nichts
automatisch zugewiesen. Der Datenbank-RPC verlangt bei Nichtverfuegbarkeit eine
explizite Bestaetigung; bereits bestehende Zuweisungen bleiben erhalten.
Selbsteintragung und Ruecktritt sind unveraendert.

Manuelle Abnahme vor Freigabe:
- Mitglied: eigener Tag, Zeitraum, Rueckgaengig und fehlgeschlagene Speicherung.
- Admin: Meldung fuer anderes Mitglied, Vorschlag, Override und bestehender Konflikt.
- Zwei Sitzungen: Nichtverfuegbarkeit nach Anzeige eines Vorschlags setzen;
  die alte Zuweisung muss eine neue Bestaetigung verlangen.
- RLS und RPC-Rechte gegen isolierte Supabase-Instanz pruefen.
- Handy: Touch-Ziele, Tastatur, Uebersicht und leere Diensttage pruefen.

Keine Mail-/Push-Benachrichtigungen, Fristen, Wochentagsserien oder weiteren
Verfuegbarkeitsstufen. Benachrichtigungen koennen spaeter zentral im
`set_availability`-RPC ueber eine transaktionale Outbox ergaenzt werden.

Pruefungen: npm test, npm run typecheck, npm run build.