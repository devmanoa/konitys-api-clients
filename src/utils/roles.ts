/**
 * Keycloak realm roles allowed to mutate CRM data (create/update/delete).
 *
 * The `konitys` realm currently defines only `admin` and `user`
 * (see keycloak/realm-export.json), so `user` is included here to keep every
 * authenticated CRM user able to work. Restrict it via WRITE_ROLES once a
 * dedicated read-only role exists in the realm.
 */
export const WRITE_ROLES: string[] = (process.env.WRITE_ROLES || 'admin,user')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
