import { afterEach,describe,expect,it,vi } from 'vitest';
import { AccountError } from '../src/lib/account-rules';

const mocks = vi.hoisted(() => ({ adminAccount:vi.fn(),sameOrigin:vi.fn(() => true),listAccounts:vi.fn(async () => []),bootstrapAdmin:vi.fn(async () => ({ sent:true })) }));
vi.mock('@/lib/server',() => ({ adminAccount:mocks.adminAccount,sameOrigin:mocks.sameOrigin }));
vi.mock('@/lib/accounts-server',() => ({ ...mocks, changeEmployeeStatus:vi.fn(),deleteEmployee:vi.fn(),importEmployees:vi.fn(),importPreview:vi.fn(),inviteEmployee:vi.fn(),sendAccountMail:vi.fn(),updateEmployee:vi.fn() }));
import { GET,POST } from '../src/app/api/admin/mitarbeiter/route';
import { POST as bootstrap } from '../src/app/api/bootstrap-admin/route';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('Admin-HTTP-Grenzen',() => {
  it('liefert fuer Mitarbeiter und fehlende Session 403 ohne privilegierten Zugriff',async () => {
    mocks.adminAccount.mockRejectedValue(new AccountError('Nur aktive Administratoren.',403));
    expect((await GET()).status).toBe(403);
    expect((await POST(new Request('https://app.invalid/api/admin/mitarbeiter',{ method:'POST',body:'{}' }))).status).toBe(403);
    expect(mocks.listAccounts).not.toHaveBeenCalled();
  });
  it('erlaubt einem geprueften Admin den Lesezugriff',async () => {
    mocks.adminAccount.mockResolvedValue({ role:'admin',account_status:'aktiv' });
    expect((await GET()).status).toBe(200);
    expect(mocks.listAccounts).toHaveBeenCalledOnce();
  });
  it('verweigert Bootstrap ohne korrektes Secret',async () => {
    vi.stubEnv('BOOTSTRAP_SECRET','a'.repeat(32));
    expect((await bootstrap(new Request('https://app.invalid/api/bootstrap-admin',{ method:'POST' }))).status).toBe(401);
    expect(mocks.bootstrapAdmin).not.toHaveBeenCalled();
  });
  it('erlaubt Bootstrap ausschliesslich in Production',async () => {
    vi.stubEnv('BOOTSTRAP_SECRET','a'.repeat(32)); vi.stubEnv('VERCEL_ENV','preview');
    const request = () => new Request('https://app.invalid/api/bootstrap-admin',{ method:'POST',headers:{ 'x-bootstrap-secret':'a'.repeat(32) } });
    expect((await bootstrap(request())).status).toBe(403);
    vi.stubEnv('VERCEL_ENV','production');
    expect((await bootstrap(request())).status).toBe(200);
    expect(mocks.bootstrapAdmin).toHaveBeenCalledOnce();
  });
});