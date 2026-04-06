export class IntegrationError extends Error {
  readonly statusCode: number;
  readonly details?: string;

  constructor(message: string, statusCode: number, details?: string) {
    super(message);
    this.name = "IntegrationError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class IntegrationNotConnectedError extends IntegrationError {
  constructor(providerLabel: string) {
    super(`${providerLabel} is not connected for this user.`, 409);
    this.name = "IntegrationNotConnectedError";
  }
}

export class TokenRefreshUnavailableError extends IntegrationError {
  constructor(providerLabel: string) {
    super(`${providerLabel} access token expired and no refresh token is available.`, 401);
    this.name = "TokenRefreshUnavailableError";
  }
}

export class UpstreamOAuthError extends IntegrationError {
  constructor(providerLabel: string, operation: string, details: string) {
    super(`${providerLabel} OAuth ${operation} failed.`, 502, details);
    this.name = "UpstreamOAuthError";
  }
}

export class UpstreamApiError extends IntegrationError {
  constructor(providerLabel: string, details: string, statusCode = 502) {
    super(`${providerLabel} API request failed.`, statusCode, details);
    this.name = "UpstreamApiError";
  }
}
