function resolveCorsOrigins(nodeEnv: string, corsOriginsVal: string): any {
  let corsOrigin: any = true;
  if (nodeEnv === 'production') {
    if (corsOriginsVal) {
      corsOrigin = corsOriginsVal.split(',').map((o) => o.trim());
    } else {
      corsOrigin = false; // Block all by default in production
    }
  } else {
    // Development mode defaults
    if (corsOriginsVal) {
      corsOrigin = corsOriginsVal.split(',').map((o) => o.trim());
    } else {
      corsOrigin = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ];
    }
  }
  return corsOrigin;
}

describe('CORS origins configuration helper', () => {
  it('should allow default local development origins in development mode when CORS_ORIGINS is empty', () => {
    const origins = resolveCorsOrigins('development', '');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://localhost:3000');
  });

  it('should split custom CORS_ORIGINS list into an array of trimmed strings in development', () => {
    const origins = resolveCorsOrigins('development', 'https://dev.domain.com, https://test.domain.com');
    expect(origins).toEqual(['https://dev.domain.com', 'https://test.domain.com']);
  });

  it('should block all by default (return false) in production when CORS_ORIGINS is empty', () => {
    const origins = resolveCorsOrigins('production', '');
    expect(origins).toBe(false);
  });

  it('should allow custom CORS_ORIGINS list in production when defined', () => {
    const origins = resolveCorsOrigins('production', 'https://production.domain.com');
    expect(origins).toEqual(['https://production.domain.com']);
  });
});
