export { FileScanner } from './scanner.js';
export {
  detectExactDuplicates,
  detectNearDuplicates,
  detectStaleness,
} from './analysis.js';
export type {
  ScannedFile,
  ScanResult,
  ScanOptions,
  PlatformScanAdapter,
} from './types.js';
export type {
  FileContentCandidate,
  ExactDuplicateGroup,
  NearDuplicateCandidate,
  NearDuplicatePair,
  StalenessCandidate,
  StalenessAssessment,
  StalenessOptions,
  OptionalLlmStalenessReasoning,
} from './analysis.js';
