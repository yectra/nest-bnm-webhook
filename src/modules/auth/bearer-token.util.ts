/** Pulls the raw token out of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(
  authorization: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;

  if (!header) {
    return undefined;
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!/^Bearer$/i.test(scheme) || rest.length !== 1) {
    return undefined;
  }

  return rest[0];
}
