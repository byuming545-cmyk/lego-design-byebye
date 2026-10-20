/** Known, safe generation failures may be shown to the user; other errors stay private. */
export class SpeedGenerationError extends Error {
  constructor(message: string, public readonly code = 'SPEED_GENERATION_FAILED') {
    super(message);
    this.name = 'SpeedGenerationError';
  }
}
