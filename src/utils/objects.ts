/**
 * Clears all enumerable properties from the object
 *
 * @param obj Random object
 * @returns The input object with deleted properties
 */
export function clearObjectProperties(obj: any): any {
  for (const prop of Object.keys(obj)) {
    // tslint:disable-next-line:no-dynamic-delete
    delete obj[prop];
  }
  return obj;
}
