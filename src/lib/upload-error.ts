export class UploadError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(code: string, message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
