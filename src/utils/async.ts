/**
 * Asynchronously calls the predicate on every element of the array and filters
 * for all elements where the predicate resolves to true.
 *
 * @param array An array to filter
 * @param predicate A predicate function that resolves to a boolean
 * @param thisArg Optional argument passed as this to the predicate
 * @returns The filtered array
 * @async
 */
export async function filterAsync<T>(
  array: T[],
  predicate: (arg: T) => Promise<boolean>,
  thisArg?: any
): Promise<T[]> {
  const verdicts = await Promise.all(array.map(predicate, thisArg));
  return array.filter((_, index) => verdicts[index]);
}
