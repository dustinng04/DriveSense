/**
 * Platform types supported by DriveSense
 */
export type Platform = 'google_drive' | 'notion' | 'unknown';

/**
 * Context types for different resources
 */
export type ContextType = 'file' | 'folder' | 'page' | 'unknown';

/**
 * Metadata extracted from the current page/context
 */
export interface ContextMetadata {
  /** Page or document title */
  title?: string;
  /** Path or breadcrumb information */
  path?: string;
}

/**
 * Detected context from a URL or page
 */
export interface DetectedContext {
  /** Platform where the context was detected */
  platform: Platform;
  /** Type of resource (file, folder, page) */
  contextType: ContextType;
  /** Unique identifier for the resource (file ID, folder ID, page ID) */
  resourceId: string | null;
  /** Original URL */
  url: string;
  /** Optional metadata extracted from the page */
  metadata?: ContextMetadata;
}

/**
 * Parser interface for platform-specific URL parsing
 */
export interface ContextParser {
  /** Platform this parser handles */
  platform: Platform;
  /** Check if this parser can handle the given URL */
  canParse(url: string): boolean;
  /** Parse the URL and extract context information */
  parse(url: string, metadata?: ContextMetadata): DetectedContext;
}
