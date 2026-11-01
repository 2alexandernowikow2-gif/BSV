import { describe, expect, it, vi } from 'vitest';
import { bootstrapOnce, employeeInput, protectAccount, requireActiveAdmin, type Account } from '../src/lib/account-rules';

const account: Account = {
  id: 'member-1', user_id: 'user-1', name: 'Test Admin', vorname: 'Test', nachname: 'Admin',
  email: 'test@example.invalid', role: 'admin', account_status: 'aktiv', archived_at: null,
  winter_active: true, summer_active: false, qualifications: [], created_at: '', updated_at: ''
};

describe('Kontorechte', () => {
  it('verweigert fehlende, eingeladene, deaktivierte und Mitarbeiter-Sessions', () => {
    for (const actor of [null, { ...account, role: 'mitarbeiter' as const }, { ...account, account_status: 'eingeladen' as const }, { ...account, account_status: 'deaktiviert' as const }, { ...account, archived_at: '2026-01-01' }]) {
      expect(() => requireActiveAdmin(actor)).toThrow('Nur aktive Administratoren');
    }
    expect(() => requireActiveAdmin(account)).not.toThrow();
  });
  it('verhindert Selbstloeschung und Selbstdeaktivierung auch bei mehreren Admins', () => {
    expect(() => protectAccount('user-1', account, 'delete', 'admin', 2)).toThrow('eigenen Zugang');
    expect(() => protectAccount('user-1', account, 'deactivate', 'admin', 2)).toThrow('eigenen Zugang');
  });
  it('schuetzt den letzten aktiven Admin gegen alle drei Entfernungswege', () => {
    for (const operation of ['edit', 'deactivate', 'delete'] as const) {
      expect(() => protectAccount('other', account, operation, 'mitarbeiter', 1)).toThrow('letzte aktive Admin');
      expect(() => protectAccount('other', account, operation, 'mitarbeiter', 2)).not.toThrow();
    }
  });
  it('validiert Rollen und normalisiert E-Mail-Adressen', () => {
    expect(employeeInput.parse({ vorname: ' Test ', nachname: '', email: 'Test@example.invalid' }).role).toBe('mitarbeiter');
    expect(employeeInput.parse({ vorname: 'Test', nachname: '', email: 'Test@example.invalid' }).email).toBe('test@example.invalid');
    expect(() => employeeInput.parse({ vorname: 'Test', nachname: '', email: 'bad', role: 'owner' })).toThrow();
  });
});

describe('Deployment-Bootstrap', () => {
  it('versendet bei wiederholten Aufrufen genau einmal', async () => {
    let claimed = false;
    const deliver = vi.fn();
    const finish = vi.fn();
    const claim = async () => { const result = { claimed: !claimed, userId: null, reason: 'Bereits eingerichtet.' }; claimed = true; return result; };
    await bootstrapOnce({ claim, deliver, finish });
    await bootstrapOnce({ claim, deliver, finish });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('sent');
  });
  it('verschickt bei parallelen Deployments nicht mehrfach', async () => {
    let claimed = false;
    const deliver = vi.fn();
    const claim = async () => { const result = { claimed: !claimed, userId: null, reason: 'Bereits beansprucht.' }; claimed = true; return result; };
    await Promise.all(Array.from({ length: 5 }, () => bootstrapOnce({ claim, deliver, finish: async () => {} })));
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it('wiederholt unklare Versandfehler nicht automatisch', async () => {
    const finish = vi.fn();
    await expect(bootstrapOnce({ claim: async () => ({ claimed: true, userId: null, reason: '' }), deliver: async () => { throw new Error('provider'); }, finish })).rejects.toThrow('Kein automatischer Neuversand');
    expect(finish).toHaveBeenCalledWith('failed');
  });
});