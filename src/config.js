/**
 * Scope3 Segments Worker Configuration
 * 
 * This file contains all configuration constants for the worker.
 */

// API Configuration
export const SCOPE3_API_ENDPOINT = 'https://rtdp.scope3.com/publishers/qa';
export const DEFAULT_CACHE_TTL = 60 * 60; // Cache for 1 hour (in seconds)
export const DEFAULT_API_TIMEOUT = 1000; // Timeout after 1000ms (1 second)

// For testing - Set to your API key to test with the real API (remove in production)
export const TEST_API_KEY = '';

// HTML Content Settings
export const HTML_PLACEHOLDER = '<!-- scope3_segments_placeholder -->';
export const DEFAULT_SCRIPT_POSITION = '</head>';
export const HTML_JS_VARIABLE = 'window.scope3_segments';