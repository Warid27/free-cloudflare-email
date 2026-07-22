import { Context } from 'hono';

/**
 * Return a success JSON response.
 * Merges { success: true } with the provided data object.
 */
export function successResponse(data: Record<string, any> = {}, status = 200) {
  return {
    success: true,
    ...data,
  };
}

/**
 * Return an error JSON response.
 */
export function errorResponse(message: string, status = 500) {
  return {
    error: message,
  };
}
