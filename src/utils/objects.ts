/**
 * Clears all enumerable properties from the object
 *
 * @param obj Random object
 * @returns The input object with deleted properties
 */
export function clearObjectProperties(obj: Record<string, any>): any {
  for (const prop of Object.keys(obj)) {
    delete obj[prop];
  }
  return obj;
}
