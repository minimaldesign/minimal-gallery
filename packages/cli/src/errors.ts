/**
 * An expected failure: a missing gallery, a bad flag, a failed command. The
 * CLI prints its message without a stack trace and exits with `exitCode`.
 */
export class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}
