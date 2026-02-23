import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockFetchSuccess,
  resetFetchMock,
  mockCanvas,
} from './test/mocks.js';

/**
 * Validation tests extracted from the MCP server logic.
 * These test the validation helpers used before API calls.
 */

// Re-implement validation helpers for isolated testing
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateRequired(value: unknown, fieldName: string): void {
  if (value === undefined || value === null) {
    throw new ValidationError(`Missing required field: ${fieldName}`);
  }
}

function validateString(value: unknown, fieldName: string, required = true): void {
  if (required) validateRequired(value, fieldName);
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new ValidationError(`Field '${fieldName}' must be a string, got ${typeof value}`);
  }
  if (required && typeof value === 'string' && value.trim().length === 0) {
    throw new ValidationError(`Field '${fieldName}' cannot be empty`);
  }
}

function validateNumber(value: unknown, fieldName: string, required = true): void {
  if (required) validateRequired(value, fieldName);
  if (value !== undefined && value !== null && typeof value !== 'number') {
    throw new ValidationError(`Field '${fieldName}' must be a number, got ${typeof value}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`Field '${fieldName}' must be a finite number`);
  }
}

function validateArray(value: unknown, fieldName: string, required = true): void {
  if (required) validateRequired(value, fieldName);
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw new ValidationError(`Field '${fieldName}' must be an array, got ${typeof value}`);
  }
}

function validateObject(value: unknown, fieldName: string, required = true): void {
  if (required) validateRequired(value, fieldName);
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError(`Field '${fieldName}' must be an object, got ${typeof value}`);
  }
}

describe('Validation Helpers', () => {
  describe('validateRequired', () => {
    it('should throw for undefined', () => {
      expect(() => validateRequired(undefined, 'test')).toThrow('Missing required field: test');
    });

    it('should throw for null', () => {
      expect(() => validateRequired(null, 'test')).toThrow('Missing required field: test');
    });

    it('should not throw for valid values', () => {
      expect(() => validateRequired('hello', 'test')).not.toThrow();
      expect(() => validateRequired(0, 'test')).not.toThrow();
      expect(() => validateRequired(false, 'test')).not.toThrow();
      expect(() => validateRequired('', 'test')).not.toThrow();
    });
  });

  describe('validateString', () => {
    it('should throw for non-string types', () => {
      expect(() => validateString(123, 'test')).toThrow("must be a string");
      expect(() => validateString(true, 'test')).toThrow("must be a string");
    });

    it('should throw for empty required string', () => {
      expect(() => validateString('', 'test', true)).toThrow("cannot be empty");
      expect(() => validateString('  ', 'test', true)).toThrow("cannot be empty");
    });

    it('should allow empty optional string', () => {
      expect(() => validateString(undefined, 'test', false)).not.toThrow();
      expect(() => validateString(null, 'test', false)).not.toThrow();
    });

    it('should accept valid strings', () => {
      expect(() => validateString('hello', 'test')).not.toThrow();
    });
  });

  describe('validateNumber', () => {
    it('should throw for non-number types', () => {
      expect(() => validateNumber('123', 'test')).toThrow("must be a number");
    });

    it('should throw for Infinity', () => {
      expect(() => validateNumber(Infinity, 'test')).toThrow("must be a finite number");
    });

    it('should throw for NaN', () => {
      expect(() => validateNumber(NaN, 'test')).toThrow("must be a finite number");
    });

    it('should accept valid numbers', () => {
      expect(() => validateNumber(42, 'test')).not.toThrow();
      expect(() => validateNumber(0, 'test')).not.toThrow();
      expect(() => validateNumber(-1, 'test')).not.toThrow();
    });

    it('should allow undefined for optional', () => {
      expect(() => validateNumber(undefined, 'test', false)).not.toThrow();
    });
  });

  describe('validateArray', () => {
    it('should throw for non-array', () => {
      expect(() => validateArray('not array', 'test')).toThrow("must be an array");
      expect(() => validateArray({}, 'test')).toThrow("must be an array");
    });

    it('should accept arrays', () => {
      expect(() => validateArray([], 'test')).not.toThrow();
      expect(() => validateArray([1, 2], 'test')).not.toThrow();
    });

    it('should allow undefined for optional', () => {
      expect(() => validateArray(undefined, 'test', false)).not.toThrow();
    });
  });

  describe('validateObject', () => {
    it('should throw for non-object', () => {
      expect(() => validateObject('not obj', 'test')).toThrow("must be an object");
      expect(() => validateObject(123, 'test')).toThrow("must be an object");
    });

    it('should throw for arrays (not plain objects)', () => {
      expect(() => validateObject([], 'test')).toThrow("must be an object");
    });

    it('should accept objects', () => {
      expect(() => validateObject({}, 'test')).not.toThrow();
      expect(() => validateObject({ a: 1 }, 'test')).not.toThrow();
    });

    it('should allow undefined for optional', () => {
      expect(() => validateObject(undefined, 'test', false)).not.toThrow();
    });
  });
});
